import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import * as discordRepo from "@kan/db/repository/discord.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import type { DiscordRoleAccessConfig } from "./config";
import {
  applyDiscordAccess,
  authorizeDiscordSession,
  syncAllDiscordUsers,
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
};

const memberResponse = (roles: string[]) =>
  new Response(JSON.stringify({ roles }), { status: 200 });

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
      });
      expect(repo.deleteSessionsByUserId).toHaveBeenCalledTimes(1);
      expect(repo.deleteSessionsByUserId).toHaveBeenCalledWith(db, "u2");
    });
  });
});
