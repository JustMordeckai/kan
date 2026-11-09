/**
 * Instance branding for self-hosted deployments, read from the runtime
 * environment:
 *
 * - `NEXT_PUBLIC_APP_NAME`: product name shown in place of "kan.bn" in the
 *   navigation, the sign in pages and the browser tab title.
 * - `NEXT_PUBLIC_LOGO_URL`: optional image shown before the product name.
 * - `NEXT_PUBLIC_FAVICON_URL`: optional favicon, served for `/favicon.ico`.
 *
 * Images accept an absolute http(s) URL or a path on the same origin
 * (`/brand/logo.svg`).
 */

export const DEFAULT_APP_NAME = "kan.bn";

const MAX_APP_NAME_LENGTH = 64;
const MAX_URL_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface Branding {
  appName: string;
  logoUrl: string | null;
  /** True when nothing visible differs from the stock Kan branding. */
  isDefault: boolean;
}

export const DEFAULT_BRANDING: Branding = {
  appName: DEFAULT_APP_NAME,
  logoUrl: null,
  isDefault: true,
};

/** Returns a trimmed, printable app name, or null to keep the default. */
export function sanitizeAppName(value: string | undefined): string | null {
  const name = value?.trim();
  if (!name) return null;
  if (name.length > MAX_APP_NAME_LENGTH || CONTROL_CHARACTERS.test(name)) {
    return null;
  }
  return name;
}

/**
 * Accepts an absolute http(s) URL or a root-relative path. Anything else
 * (javascript:, data:, protocol-relative URLs, relative paths) returns null.
 */
export function sanitizeAssetUrl(value: string | undefined): string | null {
  const url = value?.trim();
  if (!url || url.length > MAX_URL_LENGTH || CONTROL_CHARACTERS.test(url)) {
    return null;
  }

  if (url.startsWith("/")) {
    if (url.startsWith("//") || url.includes("\\")) return null;
    return url;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function parseBranding(input: {
  appName?: string;
  logoUrl?: string;
}): Branding {
  const appName = sanitizeAppName(input.appName);
  const logoUrl = sanitizeAssetUrl(input.logoUrl);

  if (!appName && !logoUrl) return DEFAULT_BRANDING;

  return {
    appName: appName ?? DEFAULT_APP_NAME,
    logoUrl,
    isDefault: (appName ?? DEFAULT_APP_NAME) === DEFAULT_APP_NAME && !logoUrl,
  };
}

/** Replaces the stock product name in a page title. */
export function brandTitle(title: string, branding: Branding): string {
  if (branding.appName === DEFAULT_APP_NAME) return title;
  return title.split(DEFAULT_APP_NAME).join(branding.appName);
}
