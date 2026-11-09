import type { DiscordRoleAccessConfig } from "./config";
import { isSnowflake } from "./config";

const DISCORD_API_URL = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
// Discord JSON error codes meaning the user simply isn't in the guild.
const NOT_A_MEMBER_CODES = new Set([10007, 10013]);

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DiscordApiError";
  }
}

export interface DiscordClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const getField = (body: unknown, field: string): unknown =>
  body && typeof body === "object"
    ? (body as Record<string, unknown>)[field]
    : undefined;

const toWaitMs = (seconds: unknown) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return 1000;
  return Math.min(Math.ceil(value * 1000), MAX_RATE_LIMIT_WAIT_MS);
};

/**
 * Returns the role ids the user holds in the configured guild, or null when
 * they are not a member. Throws DiscordApiError on any other failure so that
 * callers can fail closed.
 */
export async function fetchGuildMemberRoleIds(
  config: Pick<DiscordRoleAccessConfig, "guildId" | "botToken">,
  discordUserId: string,
  options: DiscordClientOptions = {},
): Promise<string[] | null> {
  if (!config.botToken) throw new DiscordApiError("Discord bot token missing");
  if (!isSnowflake(config.guildId) || !isSnowflake(discordUserId))
    throw new DiscordApiError("Invalid Discord id");

  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 3;
  const url = `${DISCORD_API_URL}/guilds/${config.guildId}/members/${discordUserId}`;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { Authorization: `Bot ${config.botToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DiscordApiError("Discord request failed", undefined, {
        cause: error,
      });
    }

    if (response.status === 429) {
      if (attempt >= maxRetries)
        throw new DiscordApiError("Discord rate limit exceeded", 429);
      const body = await readJson(response);
      await sleep(
        toWaitMs(
          getField(body, "retry_after") ?? response.headers.get("retry-after"),
        ),
      );
      continue;
    }

    const body = await readJson(response);

    if (response.status === 404) {
      const code = Number(getField(body, "code"));
      if (NOT_A_MEMBER_CODES.has(code)) return null;
      throw new DiscordApiError(`Discord responded with 404 (${code})`, 404);
    }

    if (!response.ok)
      throw new DiscordApiError(
        `Discord responded with ${response.status}`,
        response.status,
      );

    const roles = getField(body, "roles");
    if (!Array.isArray(roles))
      throw new DiscordApiError("Unexpected Discord member payload");

    // Spread consecutive calls (bulk sync) over the bucket's reset window.
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      await sleep(toWaitMs(response.headers.get("x-ratelimit-reset-after")));
    }

    return roles.filter((role): role is string => typeof role === "string");
  }
}
