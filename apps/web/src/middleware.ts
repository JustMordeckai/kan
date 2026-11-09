import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "next-runtime-env";

import { sanitizeAssetUrl } from "./utils/branding";

const MCP_HOSTNAMES = new Set(["mcp.kan.bn", "mcp-staging.kan.bn"]);

const OAUTH_DISCOVERY_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
]);

function resolveLoginUrl(request: NextRequest) {
  const publicBaseUrl = env("NEXT_PUBLIC_BASE_URL");

  if (publicBaseUrl?.length) {
    try {
      return new URL("/login", publicBaseUrl);
    } catch {
      // Runtime-injected values may bypass the build-time environment schema.
    }
  }

  return new URL("/login", request.url);
}

// Serves the favicon configured with NEXT_PUBLIC_FAVICON_URL instead of the
// bundled one: a path is rewritten on the same origin, a URL is redirected to.
function resolveFavicon(request: NextRequest) {
  const faviconUrl = sanitizeAssetUrl(env("NEXT_PUBLIC_FAVICON_URL"));
  if (!faviconUrl || faviconUrl === "/favicon.ico") return null;

  if (faviconUrl.startsWith("/")) {
    return NextResponse.rewrite(new URL(faviconUrl, request.url));
  }
  return NextResponse.redirect(faviconUrl, 307);
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/favicon.ico") {
    return resolveFavicon(request) ?? NextResponse.next();
  }

  const host = request.headers.get("host")?.split(":")[0];

  if (
    host &&
    MCP_HOSTNAMES.has(host) &&
    OAUTH_DISCOVERY_PATHS.has(request.nextUrl.pathname)
  ) {
    return new NextResponse(null, { status: 404 });
  }

  if (request.nextUrl.pathname === "/" && host && MCP_HOSTNAMES.has(host)) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/mcp";
    return NextResponse.rewrite(url);
  }

  if (
    request.nextUrl.pathname === "/forgot-password" &&
    env("NEXT_PUBLIC_DISABLE_EMAIL")?.toLowerCase() === "true"
  ) {
    return NextResponse.redirect(resolveLoginUrl(request));
  }

  if (request.nextUrl.pathname === "/") {
    if (env("NEXT_PUBLIC_KAN_ENV") !== "cloud") {
      return NextResponse.redirect(resolveLoginUrl(request));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/forgot-password",
    "/favicon.ico",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
  ],
};
