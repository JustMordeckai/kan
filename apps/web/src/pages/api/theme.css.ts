import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "next-runtime-env";

import { parseBranding } from "~/utils/branding";
import { buildThemeCss, parseThemeConfig } from "~/utils/theme";

let cached: { css: string; etag: string } | undefined;

// FNV-1a, enough to tell two stylesheets apart in an ETag.
const hash = (value: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

// Environment variables do not change while the process runs, so the
// stylesheet is built (and any configuration error logged) once.
function getStylesheet() {
  if (cached) return cached;

  const result = parseThemeConfig(env("NEXT_PUBLIC_THEME"));
  if (!result.ok) {
    console.warn(
      `NEXT_PUBLIC_THEME is invalid and was ignored: ${result.errors.join("; ")}`,
    );
  }

  const branding = parseBranding({
    appName: env("NEXT_PUBLIC_APP_NAME"),
    logoUrl: env("NEXT_PUBLIC_LOGO_URL"),
  });

  const css = buildThemeCss(result.ok ? result.theme : null, {
    hideDefaultBrand: !branding.isDefault,
  });
  cached = { css, etag: `"${hash(css)}"` };
  return cached;
}

/**
 * Runtime theme stylesheet, linked from `_document.tsx`. Pages are
 * prerendered at build time, so the instance colours (NEXT_PUBLIC_THEME) are
 * served from here to apply on first paint without a rebuild. Without any
 * configuration the stylesheet only holds a comment.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const { css, etag } = getStylesheet();

  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("ETag", etag);
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  return res.status(200).send(css);
}
