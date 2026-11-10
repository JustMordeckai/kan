import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { workspaceRouter } from "../src/routers/workspace";
import { createTestDb, seedTestData } from "./test-db";

vi.mock("@kan/auth/server", () => ({
  initAuth: vi.fn(() => ({ api: {} })),
}));

describe("workspace Discord accounts", () => {
  let db: TestDbClient;
  let admin: { id: string; name: string | null; email: string };
  let workspace: { id: number; publicId: string };

  const ctxFor = (user: { id: string; name: string | null; email: string }) =>
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
    opts: {
      member?: {
        publicId: string;
        role?: "admin" | "member" | "guest";
        status?: "active" | "invited" | "removed" | "paused";
        deletedAt?: Date;
        workspaceId?: number;
      };
      discordId?: string;
      otherProvider?: string;
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

    if (opts.member)
      await db.insert(schema.workspaceMembers).values({
        publicId: opts.member.publicId,
        email: user!.email,
        workspaceId: opts.member.workspaceId ?? workspace.id,
        userId: user!.id,
        createdBy: admin.id,
        role: opts.member.role ?? "member",
        status: opts.member.status ?? "active",
        deletedAt: opts.member.deletedAt ?? null,
        createdAt: new Date(),
      });

    const accounts = [
      ...(opts.discordId
        ? [{ providerId: "discord", accountId: opts.discordId }]
        : []),
      ...(opts.otherProvider
        ? [{ providerId: opts.otherProvider, accountId: `${name}-other` }]
        : []),
    ];
    for (const { providerId, accountId } of accounts)
      await db.insert(schema.account).values({
        accountId,
        providerId,
        userId: user!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    return user!;
  };

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    admin = seeded.user;
    workspace = seeded.workspace;
  });

  it("lists active members with a linked Discord account for an admin", async () => {
    await db.insert(schema.account).values({
      accountId: "100000000000000001",
      providerId: "discord",
      userId: admin.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const alice = await addUser("alice", {
      member: { publicId: "wmalice12345" },
      discordId: "100000000000000002",
      otherProvider: "google",
    });
    await addUser("bob", {
      member: { publicId: "wmbob1234567" },
      otherProvider: "google",
    });
    await addUser("removed", {
      member: { publicId: "wmremoved123", status: "removed" },
      discordId: "100000000000000003",
    });
    await addUser("invited", {
      member: { publicId: "wminvited123", status: "invited" },
      discordId: "100000000000000004",
    });
    await addUser("deleted", {
      member: { publicId: "wmdeleted123", deletedAt: new Date() },
      discordId: "100000000000000005",
    });
    await addUser("outsider", { discordId: "100000000000000006" });

    const result = await workspaceRouter
      .createCaller(ctxFor(admin))
      .discordAccounts({ workspacePublicId: workspace.publicId });

    expect(result).toEqual([
      {
        memberPublicId: "wm1234567890",
        userId: admin.id,
        discordId: "100000000000000001",
      },
      {
        memberPublicId: "wmalice12345",
        userId: alice.id,
        discordId: "100000000000000002",
      },
    ]);
  });

  it("does not list members of another workspace", async () => {
    const [other] = await db
      .insert(schema.workspaces)
      .values({
        publicId: "wsother12345",
        name: "Other",
        slug: "other-workspace",
        ownerId: admin.id,
        createdAt: new Date(),
      })
      .returning();
    await addUser("elsewhere", {
      member: { publicId: "wmelsewhere1", workspaceId: other!.id },
      discordId: "100000000000000007",
    });

    const result = await workspaceRouter
      .createCaller(ctxFor(admin))
      .discordAccounts({ workspacePublicId: workspace.publicId });

    expect(result).toEqual([]);
  });

  it.each(["member", "guest"] as const)(
    "is forbidden to a workspace %s",
    async (role) => {
      const user = await addUser(role, {
        member: { publicId: `wm${role}`.padEnd(12, "0"), role },
        discordId: "100000000000000008",
      });

      await expect(
        workspaceRouter
          .createCaller(ctxFor(user))
          .discordAccounts({ workspacePublicId: workspace.publicId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("is forbidden to someone outside the workspace", async () => {
    const user = await addUser("stranger", {
      discordId: "100000000000000009",
    });

    await expect(
      workspaceRouter
        .createCaller(ctxFor(user))
        .discordAccounts({ workspacePublicId: workspace.publicId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND for an unknown workspace", async () => {
    await expect(
      workspaceRouter
        .createCaller(ctxFor(admin))
        .discordAccounts({ workspacePublicId: "wsunknown123" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
