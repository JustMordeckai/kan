import type { BoardMemberRole } from "@kan/db/schema";

export interface BoardAccessMemberInput {
  id: number;
  publicId: string;
  email: string;
  role: string;
  discordRoleIds: string[] | null;
  discordRolesSyncedAt: Date | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
  hasDiscordAccount: boolean;
}

export interface BoardAccessBoardInput {
  id: number;
  publicId: string;
  name: string;
  isArchived: boolean;
  discordRoleIds: string[] | null;
}

export interface BoardAccessMembershipInput {
  boardId: number;
  workspaceMemberId: number;
  role: BoardMemberRole;
  createdAt: Date;
  createdBy: string | null;
  addedByName: string | null;
  addedByEmail: string | null;
}

export interface DiscordRoleInfo {
  roleId: string;
  name: string;
  colour: number;
  position: number;
}

export interface DiscordRoleRef {
  roleId: string;
  name: string | null;
  colour: number | null;
}

export type BoardAccessReason =
  | { type: "workspace_admin" }
  | ({ type: "discord_role" } & DiscordRoleRef)
  | { type: "discord_sync"; addedAt: Date }
  | {
      type: "manual";
      addedBy: { name: string | null; email: string } | null;
      addedAt: Date;
    };

export interface MemberBoardAccess {
  boardPublicId: string;
  name: string;
  isArchived: boolean;
  boardRole: BoardMemberRole | null;
  reasons: BoardAccessReason[];
}

/**
 * Explains, for every active member, which boards they reach and why. It
 * mirrors hasBoardAccess: workspace admins reach every regular board, anyone
 * else needs a board membership. A membership is explained by the board's
 * Discord roles the member held at the last sync; failing that, a plain
 * member row without an author on a role restricted board was added by the
 * role sync (whose roles have not been synced yet, or will be removed at the
 * next run), and any other row was added by hand.
 */
export const computeMemberBoardAccess = (args: {
  members: BoardAccessMemberInput[];
  boards: BoardAccessBoardInput[];
  memberships: BoardAccessMembershipInput[];
  discordRoles: DiscordRoleInfo[];
  exemptEmails: string[];
}) => {
  const rolesById = new Map(
    args.discordRoles.map((role) => [role.roleId, role]),
  );
  const toRoleRef = (roleId: string): DiscordRoleRef => {
    const role = rolesById.get(roleId);
    return { roleId, name: role?.name ?? null, colour: role?.colour ?? null };
  };
  // Highest Discord role first, as Discord lists them; unknown roles last.
  const byPosition = (a: string, b: string) =>
    (rolesById.get(b)?.position ?? -1) - (rolesById.get(a)?.position ?? -1);

  const membershipByKey = new Map(
    args.memberships.map((row) => [
      `${row.boardId}:${row.workspaceMemberId}`,
      row,
    ]),
  );

  const boards = args.boards.map((board) => ({
    boardPublicId: board.publicId,
    name: board.name,
    isArchived: board.isArchived,
    discordRoles: [...new Set(board.discordRoleIds ?? [])]
      .sort(byPosition)
      .map(toRoleRef),
  }));

  const members = args.members.map((member) => {
    const memberRoleIds = new Set(member.discordRoleIds ?? []);
    const email = member.userEmail ?? member.email;
    const isWorkspaceAdmin = member.role === "admin";

    const memberBoards: MemberBoardAccess[] = [];
    for (const board of args.boards) {
      const membership = membershipByKey.get(`${board.id}:${member.id}`);
      if (!membership && !isWorkspaceAdmin) continue;

      const reasons: BoardAccessReason[] = [];
      if (isWorkspaceAdmin) reasons.push({ type: "workspace_admin" });

      if (membership) {
        const boardRoleIds = [...new Set(board.discordRoleIds ?? [])];
        const matching = boardRoleIds
          .filter((roleId) => memberRoleIds.has(roleId))
          .sort(byPosition);

        if (matching.length) {
          for (const roleId of matching)
            reasons.push({ type: "discord_role", ...toRoleRef(roleId) });
        } else if (
          boardRoleIds.length &&
          membership.role === "member" &&
          !membership.createdBy
        ) {
          reasons.push({ type: "discord_sync", addedAt: membership.createdAt });
        } else {
          reasons.push({
            type: "manual",
            addedBy:
              membership.createdBy && membership.addedByEmail
                ? {
                    name: membership.addedByName,
                    email: membership.addedByEmail,
                  }
                : null,
            addedAt: membership.createdAt,
          });
        }
      }

      memberBoards.push({
        boardPublicId: board.publicId,
        name: board.name,
        isArchived: board.isArchived,
        boardRole: membership?.role ?? null,
        reasons,
      });
    }

    return {
      memberPublicId: member.publicId,
      userId: member.userId,
      name: member.userName,
      email,
      image: member.userImage,
      workspaceRole: member.role,
      hasDiscordAccount: member.hasDiscordAccount,
      discordExempt: args.exemptEmails.includes(email.toLowerCase()),
      discordRolesSyncedAt: member.discordRolesSyncedAt,
      boards: memberBoards,
    };
  });

  return { boards, members };
};

/** Every Discord role id the boards are restricted to. */
export const collectBoardDiscordRoleIds = (
  boards: Pick<BoardAccessBoardInput, "discordRoleIds">[],
) => [...new Set(boards.flatMap((board) => board.discordRoleIds ?? []))];
