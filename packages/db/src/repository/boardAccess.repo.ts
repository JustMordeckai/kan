import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { dbClient } from "@kan/db/client";
import {
  account,
  boardMembers,
  boards,
  users,
  workspaceMembers,
} from "@kan/db/schema";

const DISCORD_PROVIDER_ID = "discord";

/**
 * Everything needed to explain who reaches which board of a workspace:
 * its active members (with their last synced Discord roles), its live
 * regular boards and the board memberships linking them.
 */
export const getWorkspaceBoardAccessData = async (
  db: dbClient,
  workspaceId: number,
) => {
  const members = await db
    .select({
      id: workspaceMembers.id,
      publicId: workspaceMembers.publicId,
      email: workspaceMembers.email,
      role: workspaceMembers.role,
      discordRoleIds: workspaceMembers.discordRoleIds,
      discordRolesSyncedAt: workspaceMembers.discordRolesSyncedAt,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(workspaceMembers)
    .leftJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .orderBy(asc(workspaceMembers.id));

  const userIds = members.flatMap((member) =>
    member.userId ? [member.userId] : [],
  );
  const discordUserIds = new Set(
    userIds.length
      ? (
          await db
            .select({ userId: account.userId })
            .from(account)
            .where(
              and(
                inArray(account.userId, userIds),
                eq(account.providerId, DISCORD_PROVIDER_ID),
              ),
            )
        ).map((row) => row.userId)
      : [],
  );

  const workspaceBoards = await db
    .select({
      id: boards.id,
      publicId: boards.publicId,
      name: boards.name,
      isArchived: boards.isArchived,
      discordRoleIds: boards.discordRoleIds,
    })
    .from(boards)
    .where(
      and(
        eq(boards.workspaceId, workspaceId),
        eq(boards.type, "regular"),
        isNull(boards.deletedAt),
      ),
    )
    .orderBy(asc(boards.name), asc(boards.id));

  const addedBy = alias(users, "added_by");
  const memberships = await db
    .select({
      boardId: boardMembers.boardId,
      workspaceMemberId: boardMembers.workspaceMemberId,
      role: boardMembers.role,
      createdAt: boardMembers.createdAt,
      createdBy: boardMembers.createdBy,
      addedByName: addedBy.name,
      addedByEmail: addedBy.email,
    })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .leftJoin(addedBy, eq(addedBy.id, boardMembers.createdBy))
    .where(
      and(
        eq(boards.workspaceId, workspaceId),
        eq(boards.type, "regular"),
        isNull(boards.deletedAt),
      ),
    );

  return {
    members: members.map((member) => ({
      ...member,
      hasDiscordAccount: !!member.userId && discordUserIds.has(member.userId),
    })),
    boards: workspaceBoards,
    memberships,
  };
};
