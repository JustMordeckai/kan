import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import * as discordRepo from "@kan/db/repository/discord.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import type { DiscordRoleAccessConfig } from "./config";
import {
  applyDiscordAccess,
  authorizeDiscordSession,
  syncAllDiscordUsers,
  syncDiscordGuildRoles,
} from "./sync";

vi.mock("@kan/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@kan/db/repository/discord.repo", () => ({
  getDiscordAccountIdByUserId: vi.fn(),
  getAllDiscordUsers: vi.fn(),
  getUserEmail: vi.fn(),
  deleteSessionsByUserId: vi.fn(),
  activateWorkspaceMember: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  getRoleSyncedBoardsForUser: vi.fn(),
  addBoardMembers: vi.fn(),
  removeBoardMembers: vi.fn(),
  storeMemberDiscordRoleIds: vi.fn(),
  replaceDiscordRoles: vi.fn(),
}));

vi.mock("@kan/db/repository/workspace.repo", () => ({
  getByPublicId: vi.fn(),
}));

const repo = vi.mocked(discordRepo);
const mockGetWorkspace = vi.mocked(workspaceRepo.getByPublicId);

const db = {} as dbClient;

const config: DiscordRoleAccessConfig = {
  guildId: "100",
  botToken: "bot-token",
  allowedRoleIds: ["10", "11"],
  workspacePublicId: "workspace0001",
  exemptEmails: ["service@example.com"],
};

const memberResponse = (roles: string[]) =>
  new Response(JSON.stringify({ roles }), { status: 200 });

const guildRolesResponse = (
  roles: { id: string; name: string; color?: number; position?: number }[],
) => new Response(JSON.stringify(roles), { status: 200 });

const fetchReturning = (...responses: (Response | Error)[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response);
    else fetch.mockResolvedValueOnce(response);
  }
  return { fetch, sleep: () => Promise.resolve() };
};

describe("discord sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspace.mockResolvedValue({
      id: 7,
      publicId: "workspace0001",
      name: "Workspace",
      image: null,
      plan: "free",
      slug: "workspace",
      deletedAt: null,
      createdBy: null,
    });
    repo.getUserEmail.mockResolvedValue("user@example.com");
    repo.deleteSessionsByUserId.mockResolvedValue(0);
    repo.activateWorkspaceMember.mockResolvedValue("unchanged");
    repo.removeWorkspaceMember.mockResolvedValue(false);
    repo.getRoleSyncedBoardsForUser.mockResolvedValue([]);
    repo.addBoardMembers.mockImplementation((_db, rows) =>
      Promise.resolve(rows.length),
    );
    repo.removeBoardMembers.mockImplementation((_db, rows) =>
      Promise.resolve(rows.length),
    );
    repo.storeMemberDiscordRoleIds.mockResolvedValue(1);
    repo.replaceDiscordRoles.mockImplementation((_db, args) =>
      Promise.resolve(args.roles.length),
    );
  });

  describe("authorizeDiscordSession", () => {
    it("refuses a user without a linked Discord account", async () => {
      repo.getDiscordAccountIdByUserId.mockResolvedValue(undefined);
      const options = fetchReturning();

      await expect(
        authorizeDiscordSession(db, config, "user-1", options),
      ).resolves.toBe(false);
      expect(options.fetch).not.toHaveBeenCalled();
    });

    it("lets an exempt service account in without Discord", async () => {
      repo.getDiscordAccountIdByUserId.mockResolvedValue(undefined);
      repo.getUserEmail.mockResolvedValue("Service@Example.com");
      const options = fetchReturning();

      await expect(
        authorizeDiscordSession(db, config, "user-1", options),
      ).resolves.toBe(true);
      expect(options.fetch).not.toHaveBeenCalled();
    });

    it("refuses when Discord cannot be reached and changes nothing", async () => {
      repo.getDiscordAccountIdByUserId.mockResolvedValue("42");
      const options = fetchReturning(new TypeError("fetch failed"));

      await expect(
        authorizeDiscordSession(db, config, "user-1", options),
      ).resolves.toBe(false);
      expect(repo.deleteSessionsByUserId).not.toHaveBeenCalled();
      expect(repo.removeWorkspaceMember).not.toHaveBeenCalled();
    });

    it("refuses and revokes a user without an allowed role", async () => {
      repo.getDiscordAccountIdByUserId.mockResolvedValue("42");
      const options = fetchReturning(memberResponse(["99"]));

      await expect(
        authorizeDiscordSession(db, config, "user-1", options),
      ).resolves.toBe(false);
      expect(repo.deleteSessionsByUserId).toHaveBeenCalledWith(db, "user-1");
      expect(repo.removeWorkspaceMember).toHaveBeenCalledWith(db, {
        workspaceId: 7,
        userId: "user-1",
      });
      expect(repo.activateWorkspaceMember).not.toHaveBeenCalled();
    });

    it("refuses a user who left the guild", async () => {
      repo.getDiscordAccountIdByUserId.mockResolvedValue("42");
      const options = fetchReturning(
        new Response(JSON.stringify({ code: 10007 }), { status: 404 }),
      );

      await expect(
        authorizeDiscordSession(db, config, "user-1", options),
      ).resolves.toBe(false);
    });

    it("lets an allowed user in and joins them to the workspace", async () => {
      repo.getDiscordAccountIdByUserId.mockResolvedValue("42");
      const options = fetchReturning(memberResponse(["11"]));

      await expect(
        authorizeDiscordSession(db, config, "user-1", options),
      ).resolves.toBe(true);
      expect(repo.activateWorkspaceMember).toHaveBeenCalledWith(db, {
        workspaceId: 7,
        userId: "user-1",
        email: "user@example.com",
      });
      expect(repo.deleteSessionsByUserId).not.toHaveBeenCalled();
    });

    it("still lets an allowed user in when the membership sync fails", async () => {
      repo.getDiscordAccountIdByUserId.mockResolvedValue("42");
      repo.activateWorkspaceMember.mockRejectedValue(new Error("db down"));
      const options = fetchReturning(memberResponse(["10"]));

      await expect(
        authorizeDiscordSession(db, config, "user-1", options),
      ).resolves.toBe(true);
    });
  });

  describe("applyDiscordAccess", () => {
    it("syncs role based boards from the member's roles", async () => {
      repo.getRoleSyncedBoardsForUser.mockResolvedValue([
        {
          boardId: 1,
          workspaceMemberId: 5,
          discordRoleIds: ["11"],
          role: null,
        },
        {
          boardId: 2,
          workspaceMemberId: 5,
          discordRoleIds: ["12"],
          role: "member",
        },
      ]);

      const result = await applyDiscordAccess(
        db,
        config,
        { userId: "user-1", email: "user@example.com" },
        ["10", "11"],
      );

      expect(repo.addBoardMembers).toHaveBeenCalledWith(db, [
        { boardId: 1, workspaceMemberId: 5 },
      ]);
      expect(repo.removeBoardMembers).toHaveBeenCalledWith(db, [
        { boardId: 2, workspaceMemberId: 5 },
      ]);
      expect(result).toMatchObject({
        allowed: true,
        boardMembershipsAdded: 1,
        boardMembershipsRemoved: 1,
      });
    });

    it("stores the member's current Discord roles", async () => {
      await applyDiscordAccess(
        db,
        config,
        { userId: "user-1", email: "user@example.com" },
        ["10", "12"],
      );

      expect(repo.storeMemberDiscordRoleIds).toHaveBeenCalledWith(db, {
        userId: "user-1",
        roleIds: ["10", "12"],
      });
    });

    it("stores no role for a user who left the guild", async () => {
      await applyDiscordAccess(
        db,
        config,
        { userId: "user-1", email: "user@example.com" },
        null,
      );

      expect(repo.storeMemberDiscordRoleIds).toHaveBeenCalledWith(db, {
        userId: "user-1",
        roleIds: [],
      });
    });

    it("still applies access when storing the roles fails", async () => {
      repo.storeMemberDiscordRoleIds.mockRejectedValue(new Error("db down"));
      repo.getRoleSyncedBoardsForUser.mockResolvedValue([
        {
          boardId: 1,
          workspaceMemberId: 5,
          discordRoleIds: ["11"],
          role: null,
        },
      ]);

      await expect(
        applyDiscordAccess(
          db,
          config,
          { userId: "user-1", email: "user@example.com" },
          ["11"],
        ),
      ).resolves.toMatchObject({ allowed: true, boardMembershipsAdded: 1 });
    });

    it("skips the workspace when none is configured", async () => {
      await applyDiscordAccess(
        db,
        { ...config, workspacePublicId: null },
        { userId: "user-1", email: "user@example.com" },
        ["10"],
      );

      expect(mockGetWorkspace).not.toHaveBeenCalled();
      expect(repo.activateWorkspaceMember).not.toHaveBeenCalled();
    });
  });

  describe("syncAllDiscordUsers", () => {
    it("summarises the sync and leaves users Discord failed on untouched", async () => {
      repo.getAllDiscordUsers.mockResolvedValue([
        { userId: "u1", email: "a@example.com", discordUserId: "1" },
        { userId: "u2", email: "b@example.com", discordUserId: "2" },
        { userId: "u3", email: "c@example.com", discordUserId: "3" },
      ]);
      repo.activateWorkspaceMember.mockResolvedValue("joined");
      repo.removeWorkspaceMember.mockResolvedValue(true);
      repo.deleteSessionsByUserId.mockResolvedValue(2);
      const options = fetchReturning(
        guildRolesResponse([
          { id: "10", name: "Staff", color: 0xff0000, position: 3 },
          { id: "11", name: "Dev", position: 2 },
        ]),
        memberResponse(["10"]),
        memberResponse([]),
        new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
      );

      const summary = await syncAllDiscordUsers(db, config, options);

      expect(summary).toEqual({
        users: 3,
        allowed: 1,
        denied: 1,
        failed: 1,
        workspaceJoined: 1,
        workspaceRemoved: 1,
        sessionsDeleted: 2,
        boardMembershipsAdded: 0,
        boardMembershipsRemoved: 0,
        guildRoles: 2,
      });
      expect(repo.replaceDiscordRoles).toHaveBeenCalledWith(db, {
        guildId: "100",
        roles: [
          { id: "10", name: "Staff", colour: 0xff0000, position: 3 },
          { id: "11", name: "Dev", colour: 0, position: 2 },
        ],
      });
      // The user Discord failed on keeps the roles stored last time.
      expect(repo.storeMemberDiscordRoleIds).toHaveBeenCalledTimes(2);
      expect(repo.storeMemberDiscordRoleIds).not.toHaveBeenCalledWith(
        db,
        expect.objectContaining({ userId: "u3" }),
      );
      expect(repo.deleteSessionsByUserId).toHaveBeenCalledTimes(1);
      expect(repo.deleteSessionsByUserId).toHaveBeenCalledWith(db, "u2");
    });
  });

  describe("syncDiscordGuildRoles", () => {
    it("keeps going when Discord refuses the roles request", async () => {
      const options = fetchReturning(
        new Response(JSON.stringify({ message: "Missing Access" }), {
          status: 403,
        }),
      );

      await expect(syncDiscordGuildRoles(db, config, options)).resolves.toBe(
        null,
      );
      expect(repo.replaceDiscordRoles).not.toHaveBeenCalled();
    });

    it("returns null when storing the roles fails", async () => {
      repo.replaceDiscordRoles.mockRejectedValue(new Error("db down"));
      const options = fetchReturning(guildRolesResponse([]));

      await expect(syncDiscordGuildRoles(db, config, options)).resolves.toBe(
        null,
      );
    });

    it("still syncs every user when the roles request fails", async () => {
      repo.getAllDiscordUsers.mockResolvedValue([
        { userId: "u1", email: "a@example.com", discordUserId: "1" },
      ]);
      const options = fetchReturning(
        new TypeError("fetch failed"),
        memberResponse(["10"]),
      );

      const summary = await syncAllDiscordUsers(db, config, options);

      expect(summary).toMatchObject({ users: 1, allowed: 1, guildRoles: null });
      expect(repo.storeMemberDiscordRoleIds).toHaveBeenCalledWith(db, {
        userId: "u1",
        roleIds: ["10"],
      });
    });
  });
});
