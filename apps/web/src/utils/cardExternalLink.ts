// Mirrors the API rule for card.externalUrl: https only, 2048 characters max.
export const CARD_EXTERNAL_URL_MAX_LENGTH = 2048;

const DISCORD_HOSTNAMES = new Set([
  "discord.com",
  "www.discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
  "www.discordapp.com",
  "ptb.discordapp.com",
  "canary.discordapp.com",
]);

export interface CardExternalLink {
  url: string;
  // Shown next to "Open link", without a leading "www.".
  hostname: string;
  isDiscord: boolean;
}

export type CardExternalUrlError = "invalid" | "notHttps" | "tooLong";

/**
 * Checks a link typed by the user. Returns null when the API will accept it.
 */
export function getCardExternalUrlError(
  value: string,
): CardExternalUrlError | null {
  const trimmed = value.trim();

  if (trimmed.length > CARD_EXTERNAL_URL_MAX_LENGTH) return "tooLong";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "invalid";
  }

  if (url.protocol !== "https:") return "notHttps";

  return null;
}

/**
 * Describes a card's external link for display, or null when there is none
 * or it is not a valid https link (never rendered as a clickable link then).
 */
export function parseCardExternalLink(
  value: string | null | undefined,
): CardExternalLink | null {
  if (!value || getCardExternalUrlError(value)) return null;

  const url = new URL(value.trim());
  const hostname = url.hostname.toLowerCase();

  return {
    url: url.href,
    hostname: hostname.replace(/^www\./, ""),
    isDiscord: DISCORD_HOSTNAMES.has(hostname),
  };
}
