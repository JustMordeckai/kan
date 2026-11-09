const SNOWFLAKE = /^\d{1,20}$/;

export const isSnowflake = (value: string) => SNOWFLAKE.test(value);

export interface DiscordRoleAccessConfig {
  guildId: string;
  botToken: string;
  allowedRoleIds: string[];
  workspacePublicId: string | null;
  exemptEmails: string[];
}

/** Parses a comma separated list of Discord ids, dropping anything else. */
export const parseRoleIds = (value: string | null | undefined): string[] => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(isSnowflake),
  ),
];

/** Parses a comma separated list of emails, lower-cased. */
export const parseEmails = (value: string | null | undefined): string[] => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes("@")),
  ),
];

/** Returns null when Discord role based access is turned off. */
export const getDiscordRoleAccessConfig =
  (): DiscordRoleAccessConfig | null => {
    const guildId = process.env.DISCORD_GUILD_ID?.trim();
    const workspacePublicId =
      process.env.DISCORD_WORKSPACE_PUBLIC_ID?.trim() ?? "";

    if (!guildId) return null;

    return {
      guildId,
      botToken: process.env.DISCORD_BOT_TOKEN?.trim() ?? "",
      allowedRoleIds: parseRoleIds(process.env.DISCORD_ALLOWED_ROLE_IDS),
      workspacePublicId:
        workspacePublicId.length > 0 ? workspacePublicId : null,
      exemptEmails: parseEmails(process.env.DISCORD_EXEMPT_EMAILS),
    };
  };

export const isDiscordRoleAccessEnabled = () =>
  getDiscordRoleAccessConfig() !== null;

export const getDiscordSyncSecret = () =>
  process.env.DISCORD_SYNC_SECRET?.trim() ?? "";
