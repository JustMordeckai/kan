import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as discordRepo from "@kan/db/repository/discord.repo";
import * as schema from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { workspaceRouter } from "../src/routers/workspace";
import { createTestDb, seedTestData } from "./test-db";

vi.mock("@kan/auth/server", () => ({
  initAuth: vi.fn(() => ({ api: {} })),
}));

type TestUser = { id: string; name: string | null; email: string };

describe("workspace member board access", () => {
  let db: TestDbClient;
  let admin: TestUser;
  let workspace: { id: number; publicId: string };

  const ctxFor = (user: TestUser) =>
    ({
      db,
      user: {
        ...user,
        name: user.name ?? "",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      headers: new Headers(),
    }) as never;

  const addUser = async (
    name: string,
    member?: {
      publicId: string;
      role?: "admin" | "member" | "guest";
      status?: "active" | "invited" | "removed" | "paused";
    },
  ) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name,
        email: `${name}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    let memberId: number | undefined;
    if (member) {
      const [row] = await db
        .insert(schema.workspaceMembers)
        .values({
          publicId: member.publicId,
          email: user!.email,
          workspaceId: workspace.id,
          userId: user!.id,
          createdBy: admin.id,
          role: member.role ?? "member",
          status: member.status ?? "active",
          createdAt: new Date(),
        })
        .returning();
      memberId = row!.id;
    }

    return { user: user!, memberId: memberId! };
  };

  const addBoard = async (
    publicId: string,
    name: string,
    opts: {
      discordRoleIds?: string[];
      type?: "regular" | "template";
      deletedAt?: Date;
    } = {},
  ) => {
    const [board] = await db
      .insert(schema.boards)
      .values({
        publicId,
        name,
        slug: publicId,
        workspaceId: workspace.id,
        createdBy: admin.id,
        discordRoleIds: opts.discordRoleIds ?? null,
        type: opts.type ?? "regular",
        deletedAt: opts.deletedAt ?? null,
      })
      .returning();
    return board!;
  };

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    admin = seeded.user;
    workspace = seeded.workspace;
    process.env.DISCORD_GUILD_ID = "100";
    process.env.DISCORD_EXEMPT_EMAILS = "service@example.com";
  });

  afterEach(() => {
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_EXEMPT_EMAILS;
  });

  it("explains each member's access from the stored Discord data", async () => {
    const staffBoard = await addBoard("bdstaff12345", "Staff", {
      discordRoleIds: ["200", "300"],
    });
    const openBoard = await addBoard("bdopen123456", "Open");
    await addBoard("bdtemplate12", "Template", { type: "template" });
    await addBoard("bddeleted123", "Deleted", { deletedAt: new Date() });

    const alice = await addUser("alice", { publicId: "wmalice12345" });
    const bob = await addUser("bob", { publicId: "wmbob1234567" });
    const service = await addUser("service", { publicId: "wmservice123" });
    await addUser("gone", { publicId: "wmgone123456", status: "removed" });

    await discordRepo.replaceDiscordRoles(db, {
      guildId: "100",
      roles: [
        { id: "200", name: "Staff", colour: 0x3498db, position: 4 },
        { id: "300", name: "Dev", colour: 0, position: 1 },
      ],
    });
    await discordRepo.storeMemberDiscordRoleIds(db, {
      userId: alice.user.id,
      roleIds: ["300"],
    });
    // Bob lost his role since the sync added him.
    await discordRepo.storeMemberDiscordRoleIds(db, {
      userId: bob.user.id,
      roleIds: [],
    });

    await db.insert(schema.boardMembers).values([
      { boardId: staffBoard.id, workspaceMemberId: alice.memberId },
      { boardId: staffBoard.id, workspaceMemberId: bob.memberId },
      {
        boardId: openBoard.id,
        workspaceMemberId: service.memberId,
        createdBy: admin.id,
      },
    ]);

    const result = await workspaceRouter
      .createCaller(ctxFor(admin))
      .memberBoardAccess({ workspacePublicId: workspace.publicId });

    expect(result.discordRoleAccessEnabled).toBe(true);
    expect(result.boards).toEqual([
      {
        boardPublicId: "bdopen123456",
        name: "Open",
        isArchived: false,
        discordRoles: [],
      },
      {
        boardPublicId: "bdstaff12345",
        name: "Staff",
        isArchived: false,
        discordRoles: [
          { roleId: "200", name: "Staff", colour: 0x3498db },
          { roleId: "300", name: "Dev", colour: 0 },
        ],
      },
    ]);

    const byId = new Map(result.members.map((m) => [m.memberPublicId, m]));
    expect([...byId.keys()]).toEqual([
      "wm1234567890",
      "wmalice12345",
      "wmbob1234567",
      "wmservice123",
    ]);

    expect(byId.get("wm1234567890")?.boards).toEqual([
      expect.objectContaining({
        boardPublicId: "bdopen123456",
        boardRole: null,
        reasons: [{ type: "workspace_admin" }],
      }),
      expect.objectContaining({
        boardPublicId: "bdstaff12345",
        boardRole: null,
        reasons: [{ type: "workspace_admin" }],
      }),
    ]);

    expect(byId.get("wmalice12345")).toMatchObject({
      name: "alice",
      email: "alice@example.com",
      hasDiscordAccount: false,
      discordExempt: false,
      discordRolesSyncedAt: expect.any(Date),
      boards: [
        {
          boardPublicId: "bdstaff12345",
          boardRole: "member",
          reasons: [
            { type: "discord_role", roleId: "300", name: "Dev", colour: 0 },
          ],
        },
      ],
    });

    expect(byId.get("wmbob1234567")?.boards).toEqual([
      expect.objectContaining({
        boardPublicId: "bdstaff12345",
        reasons: [{ type: "discord_sync", addedAt: expect.any(Date) }],
      }),
    ]);

    expect(byId.get("wmservice123")).toMatchObject({
      discordExempt: true,
      discordRolesSyncedAt: null,
      boards: [
        {
          boardPublicId: "bdopen123456",
          reasons: [
            {
              type: "manual",
              addedBy: { name: "Test User", email: "test@example.com" },
              addedAt: expect.any(Date),
            },
          ],
        },
      ],
    });
  });

  it("mirrors the guild roles: upserts and drops deleted roles", async () => {
    await discordRepo.replaceDiscordRoles(db, {
      guildId: "100",
      roles: [
        { id: "200", name: "Staff", colour: 1, position: 2 },
        { id: "300", name: "Dev", colour: 2, position: 1 },
      ],
    });
    await discordRepo.replaceDiscordRoles(db, {
      guildId: "100",
      roles: [{ id: "200", name: "Staff team", colour: 3, position: 5 }],
    });

    await expect(
      discordRepo.getDiscordRolesByIds(db, ["200", "300"]),
    ).resolves.toEqual([
      { roleId: "200", name: "Staff team", colour: 3, position: 5 },
    ]);
  });

  it("stores roles on every live membership of the user", async () => {
    const carol = await addUser("carol", { publicId: "wmcarol12345" });

    await expect(
      discordRepo.storeMemberDiscordRoleIds(db, {
        userId: carol.user.id,
        roleIds: ["1", "2", "1"],
      }),
    ).resolves.toBe(1);

    const [row] = await db
      .select({
        discordRoleIds: schema.workspaceMembers.discordRoleIds,
        discordRolesSyncedAt: schema.workspaceMembers.discordRolesSyncedAt,
      })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.id, carol.memberId));
    expect(row).toEqual({
      discordRoleIds: ["1", "2"],
      discordRolesSyncedAt: expect.any(Date),
    });
  });

  it.each(["member", "guest"] as const)(
    "is forbidden to a workspace %s",
    async (role) => {
      const { user } = await addUser(role, {
        publicId: `wm${role}`.padEnd(12, "0"),
        role,
      });

      await expect(
        workspaceRouter
          .createCaller(ctxFor(user))
          .memberBoardAccess({ workspacePublicId: workspace.publicId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("is forbidden to someone outside the workspace", async () => {
    const { user } = await addUser("stranger");

    await expect(
      workspaceRouter
        .createCaller(ctxFor(user))
        .memberBoardAccess({ workspacePublicId: workspace.publicId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND for an unknown workspace", async () => {
    await expect(
      workspaceRouter
        .createCaller(ctxFor(admin))
        .memberBoardAccess({ workspacePublicId: "wsunknown123" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports Discord role access as off when it is not configured", async () => {
    delete process.env.DISCORD_GUILD_ID;

    const result = await workspaceRouter
      .createCaller(ctxFor(admin))
      .memberBoardAccess({ workspacePublicId: workspace.publicId });

    expect(result).toMatchObject({
      discordRoleAccessEnabled: false,
      boards: [],
      members: [{ memberPublicId: "wm1234567890", boards: [] }],
    });
  });
});
