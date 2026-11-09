import type { BoardMemberRole } from "@kan/db/schema";

/** Null member roles mean the user is not in the guild at all. */
export const hasAllowedRole = (
  memberRoleIds: readonly string[] | null,
  allowedRoleIds: readonly string[],
) => memberRoleIds?.some((roleId) => allowedRoleIds.includes(roleId)) ?? false;

export interface RoleSyncedBoardMembership {
  boardId: number;
  workspaceMemberId: number;
  discordRoleIds: string[];
  role: BoardMemberRole | null;
}

export interface BoardMembershipKey {
  boardId: number;
  workspaceMemberId: number;
}

/**
 * Board memberships to add or remove so that a user is a member of exactly
 * the role-synced boards one of their roles grants. Board admins are left
 * alone: that role is only ever given by hand.
 */
export const computeBoardMembershipChanges = (
  boards: readonly RoleSyncedBoardMembership[],
  memberRoleIds: readonly string[],
) => {
  const add: BoardMembershipKey[] = [];
  const remove: BoardMembershipKey[] = [];

  for (const board of boards) {
    const key = {
      boardId: board.boardId,
      workspaceMemberId: board.workspaceMemberId,
    };
    const entitled = board.discordRoleIds.some((roleId) =>
      memberRoleIds.includes(roleId),
    );

    if (entitled && board.role === null) add.push(key);
    else if (!entitled && board.role === "member") remove.push(key);
  }

  return { add, remove };
};
