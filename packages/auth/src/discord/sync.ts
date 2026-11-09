import type { dbClient } from "@kan/db/client";
import * as discordRepo from "@kan/db/repository/discord.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { createLogger } from "@kan/logger";

import type { DiscordClientOptions } from "./client";
import type { DiscordRoleAccessConfig } from "./config";
import { computeBoardMembershipChanges, hasAllowedRole } from "./access";
import { fetchGuildMemberRoleIds } from "./client";

const log = createLogger("discord");

export interface DiscordAccessResult {
  allowed: boolean;
  joinedWorkspace: boolean;
  removedFromWorkspace: boolean;
  sessionsDeleted: number;
  boardMembershipsAdded: number;
  boardMembershipsRemoved: number;
}

const getConfiguredWorkspaceId = async (
  db: dbClient,
  config: DiscordRoleAccessConfig,
) => {
  if (!config.workspacePublicId) return null;

  const workspace = await workspaceRepo.getByPublicId(
    db,
    config.workspacePublicId,
  );

  if (!workspace || workspace.deletedAt) {
    log.warn(
      { workspacePublicId: config.workspacePublicId },
      "DISCORD_WORKSPACE_PUBLIC_ID does not match a workspace",
    );
    return null;
  }

  return workspace.id;
};

/**
 * Brings a user's workspace and board memberships in line with their Discord
 * roles. memberRoleIds is null when the user is not in the guild.
 */
export async function applyDiscordAccess(
  db: dbClient,
  config: DiscordRoleAccessConfig,
  user: { userId: string; email: string },
  memberRoleIds: string[] | null,
): Promise<DiscordAccessResult> {
  const allowed = hasAllowedRole(memberRoleIds, config.allowedRoleIds);
  const workspaceId = await getConfiguredWorkspaceId(db, config);
  const result: DiscordAccessResult = {
    allowed,
    joinedWorkspace: false,
    removedFromWorkspace: false,
    sessionsDeleted: 0,
    boardMembershipsAdded: 0,
    boardMembershipsRemoved: 0,
  };

  if (allowed) {
    if (workspaceId) {
      const outcome = await discordRepo.activateWorkspaceMember(db, {
        workspaceId,
        userId: user.userId,
        email: user.email,
      });
      result.joinedWorkspace = outcome === "joined";
    }
  } else {
    result.sessionsDeleted = await discordRepo.deleteSessionsByUserId(
      db,
      user.userId,
    );
    if (workspaceId) {
      result.removedFromWorkspace = await discordRepo.removeWorkspaceMember(
        db,
        { workspaceId, userId: user.userId },
      );
    }
  }

  const boards = await discordRepo.getRoleSyncedBoardsForUser(db, user.userId);
  const changes = computeBoardMembershipChanges(
    boards,
    allowed ? (memberRoleIds ?? []) : [],
  );

  result.boardMembershipsAdded = await discordRepo.addBoardMembers(
    db,
    changes.add,
  );
  result.boardMembershipsRemoved = await discordRepo.removeBoardMembers(
    db,
    changes.remove,
  );

  return result;
}

/**
 * Whether a Discord user may sign in. Any Discord failure counts as a
 * refusal: access is never granted by default.
 */
export async function isDiscordUserAllowed(
  config: DiscordRoleAccessConfig,
  discordUserId: string,
  options?: DiscordClientOptions,
) {
  try {
    const memberRoleIds = await fetchGuildMemberRoleIds(
      config,
      discordUserId,
      options,
    );
    return hasAllowedRole(memberRoleIds, config.allowedRoleIds);
  } catch (error) {
    log.error({ err: error, discordUserId }, "Discord role check failed");
    return false;
  }
}

/**
 * Sign-in gate run before every session is created: refuses users without a
 * linked Discord account or without an allowed role, and syncs the
 * memberships of the others.
 */
export async function authorizeDiscordSession(
  db: dbClient,
  config: DiscordRoleAccessConfig,
  userId: string,
  options?: DiscordClientOptions,
): Promise<boolean> {
  const discordUserId = await discordRepo.getDiscordAccountIdByUserId(
    db,
    userId,
  );

  if (!discordUserId) {
    // Service accounts (automation, maintenance) listed by email keep their own sign-in method.
    const email = await discordRepo.getUserEmail(db, userId);
    if (email && config.exemptEmails.includes(email.toLowerCase())) {
      return true;
    }

    log.info({ userId }, "Sign-in refused: no linked Discord account");
    return false;
  }

  let memberRoleIds: string[] | null;
  try {
    memberRoleIds = await fetchGuildMemberRoleIds(
      config,
      discordUserId,
      options,
    );
  } catch (error) {
    log.error({ err: error, userId }, "Sign-in refused: Discord unavailable");
    return false;
  }

  const allowed = hasAllowedRole(memberRoleIds, config.allowedRoleIds);

  try {
    const email = await discordRepo.getUserEmail(db, userId);
    if (email) {
      await applyDiscordAccess(db, config, { userId, email }, memberRoleIds);
    }
  } catch (error) {
    log.error({ err: error, userId }, "Discord membership sync failed");
  }

  if (!allowed) log.info({ userId }, "Sign-in refused: no allowed role");

  return allowed;
}

export interface DiscordSyncSummary {
  users: number;
  allowed: number;
  denied: number;
  failed: number;
  workspaceJoined: number;
  workspaceRemoved: number;
  sessionsDeleted: number;
  boardMembershipsAdded: number;
  boardMembershipsRemoved: number;
}

/** Re-checks every user with a Discord account, one at a time. */
export async function syncAllDiscordUsers(
  db: dbClient,
  config: DiscordRoleAccessConfig,
  options?: DiscordClientOptions,
): Promise<DiscordSyncSummary> {
  const users = await discordRepo.getAllDiscordUsers(db);
  const summary: DiscordSyncSummary = {
    users: users.length,
    allowed: 0,
    denied: 0,
    failed: 0,
    workspaceJoined: 0,
    workspaceRemoved: 0,
    sessionsDeleted: 0,
    boardMembershipsAdded: 0,
    boardMembershipsRemoved: 0,
  };

  for (const user of users) {
    try {
      // A failed lookup leaves the user untouched rather than revoking them.
      const memberRoleIds = await fetchGuildMemberRoleIds(
        config,
        user.discordUserId,
        options,
      );
      const result = await applyDiscordAccess(db, config, user, memberRoleIds);

      if (result.allowed) summary.allowed++;
      else summary.denied++;
      if (result.joinedWorkspace) summary.workspaceJoined++;
      if (result.removedFromWorkspace) summary.workspaceRemoved++;
      summary.sessionsDeleted += result.sessionsDeleted;
      summary.boardMembershipsAdded += result.boardMembershipsAdded;
      summary.boardMembershipsRemoved += result.boardMembershipsRemoved;
    } catch (error) {
      summary.failed++;
      log.error({ err: error, userId: user.userId }, "Discord sync failed");
    }
  }

  return summary;
}
