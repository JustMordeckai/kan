import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  account,
  boardMembers,
  boards,
  session,
  users,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import * as boardMemberRepo from "./boardMember.repo";
import * as permissionRepo from "./permission.repo";

const DISCORD_PROVIDER_ID = "discord";

export const getDiscordAccountIdByUserId = async (
  db: dbClient,
  userId: string,
) => {
  const [result] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, DISCORD_PROVIDER_ID),
      ),
    )
    .limit(1);

  return result?.accountId;
};

export const getAllDiscordUsers = async (db: dbClient) => {
  return db
    .select({
      userId: users.id,
      email: users.email,
      discordUserId: account.accountId,
    })
    .from(account)
    .innerJoin(users, eq(users.id, account.userId))
    .where(eq(account.providerId, DISCORD_PROVIDER_ID));
};

export const getUserEmail = async (db: dbClient, userId: string) => {
  const [result] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result?.email;
};

// Only deletes a user that has never been signed in nor linked to any
// account, i.e. one created moments ago by a refused OAuth sign-up.
export const deleteUserIfUnused = async (db: dbClient, userId: string) => {
  const deleted = await db
    .delete(users)
    .where(
      and(
        eq(users.id, userId),
        notExists(
          db
            .select({ id: account.id })
            .from(account)
            .where(eq(account.userId, userId)),
        ),
        notExists(
          db
            .select({ id: session.id })
            .from(session)
            .where(eq(session.userId, userId)),
        ),
      ),
    )
    .returning({ id: users.id });

  return deleted.length > 0;
};

export const deleteSessionsByUserId = async (db: dbClient, userId: string) => {
  const deleted = await db
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id });

  return deleted.length;
};

/**
 * Makes the user an active member of the workspace without an invitation.
 * Reuses their existing row (or a pending invitation sent to their email)
 * and never changes the role of an existing member.
 */
export const activateWorkspaceMember = async (
  db: dbClient,
  args: { workspaceId: number; userId: string; email: string },
): Promise<"joined" | "unchanged"> => {
  const existing = await db.query.workspaceMembers.findFirst({
    columns: { id: true, status: true },
    where: and(
      eq(workspaceMembers.workspaceId, args.workspaceId),
      eq(workspaceMembers.userId, args.userId),
      isNull(workspaceMembers.deletedAt),
    ),
    orderBy: (m, { asc }) => [
      sql`(${m.status} = 'active') desc`,
      asc(m.createdAt),
    ],
  });

  // Paused members are managed by billing, not by role sync.
  if (existing?.status === "active" || existing?.status === "paused")
    return "unchanged";

  if (existing) {
    await db
      .update(workspaceMembers)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(workspaceMembers.id, existing.id));
    return "joined";
  }

  const invitation = await db.query.workspaceMembers.findFirst({
    columns: { id: true },
    where: and(
      eq(workspaceMembers.workspaceId, args.workspaceId),
      sql`lower(${workspaceMembers.email}) = lower(${args.email})`,
      eq(workspaceMembers.status, "invited"),
      isNull(workspaceMembers.userId),
      isNull(workspaceMembers.deletedAt),
    ),
  });

  if (invitation) {
    await db
      .update(workspaceMembers)
      .set({ status: "active", userId: args.userId, updatedAt: new Date() })
      .where(eq(workspaceMembers.id, invitation.id));
    return "joined";
  }

  const memberRole = await permissionRepo.getRoleByWorkspaceIdAndName(
    db,
    args.workspaceId,
    "member",
  );

  await db.insert(workspaceMembers).values({
    publicId: generateUID(),
    email: args.email,
    userId: args.userId,
    workspaceId: args.workspaceId,
    createdBy: args.userId,
    role: "member",
    roleId: memberRole?.id ?? null,
    status: "active",
  });

  return "joined";
};

/**
 * Marks the user's membership as removed (cards, comments and the row itself
 * are kept so they can be reactivated) and drops their board memberships.
 */
export const removeWorkspaceMember = async (
  db: dbClient,
  args: { workspaceId: number; userId: string },
) => {
  return db.transaction(async (tx) => {
    const removed = await tx
      .update(workspaceMembers)
      .set({ status: "removed", updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, args.workspaceId),
          eq(workspaceMembers.userId, args.userId),
          inArray(workspaceMembers.status, ["active", "invited"]),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .returning({ id: workspaceMembers.id });

    for (const member of removed) {
      await boardMemberRepo.removeAllForMember(tx, member.id);
    }

    return removed.length > 0;
  });
};

/**
 * Boards with Discord roles set, in every workspace where the user is an
 * active member, with the user's current membership of each board.
 */
export const getRoleSyncedBoardsForUser = async (
  db: dbClient,
  userId: string,
) => {
  const rows = await db
    .select({
      boardId: boards.id,
      discordRoleIds: boards.discordRoleIds,
      workspaceMemberId: workspaceMembers.id,
      role: boardMembers.role,
    })
    .from(boards)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, boards.workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .leftJoin(
      boardMembers,
      and(
        eq(boardMembers.boardId, boards.id),
        eq(boardMembers.workspaceMemberId, workspaceMembers.id),
      ),
    )
    .where(
      and(
        isNotNull(boards.discordRoleIds),
        isNull(boards.deletedAt),
        eq(boards.type, "regular"),
      ),
    );

  return rows.map((row) => ({
    boardId: row.boardId,
    discordRoleIds: row.discordRoleIds ?? [],
    workspaceMemberId: row.workspaceMemberId,
    role: row.role,
  }));
};

export const addBoardMembers = async (
  db: dbClient,
  rows: { boardId: number; workspaceMemberId: number }[],
) => {
  if (!rows.length) return 0;

  const inserted = await db
    .insert(boardMembers)
    .values(rows.map((row) => ({ ...row, role: "member" as const })))
    .onConflictDoNothing()
    .returning({ boardId: boardMembers.boardId });

  return inserted.length;
};

// Only plain members are removed: board admins are managed by hand.
export const removeBoardMembers = async (
  db: dbClient,
  rows: { boardId: number; workspaceMemberId: number }[],
) => {
  let removed = 0;

  for (const row of rows) {
    const deleted = await db
      .delete(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId, row.boardId),
          eq(boardMembers.workspaceMemberId, row.workspaceMemberId),
          eq(boardMembers.role, "member"),
        ),
      )
      .returning({ boardId: boardMembers.boardId });
    removed += deleted.length;
  }

  return removed;
};
