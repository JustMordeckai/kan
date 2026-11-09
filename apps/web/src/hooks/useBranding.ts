import { env } from "next-runtime-env";
import { useSyncExternalStore } from "react";

import type { Branding } from "~/utils/branding";
import { DEFAULT_BRANDING, parseBranding } from "~/utils/branding";

let cachedKey: string | undefined;
let cachedBranding: Branding = DEFAULT_BRANDING;

function readRuntimeBranding(): Branding {
  let appName: string | undefined;
  let logoUrl: string | undefined;
  try {
    appName = env("NEXT_PUBLIC_APP_NAME");
    logoUrl = env("NEXT_PUBLIC_LOGO_URL");
  } catch {
    // window.__ENV is missing when /__ENV.js failed to load.
    return DEFAULT_BRANDING;
  }

  // useSyncExternalStore needs a stable snapshot between calls.
  const key = JSON.stringify([appName, logoUrl]);
  if (key !== cachedKey) {
    cachedKey = key;
    cachedBranding = parseBranding({ appName, logoUrl });
  }
  return cachedBranding;
}

const subscribe = () => () => undefined;
const getServerBranding = () => DEFAULT_BRANDING;

/**
 * Runtime branding of the instance. Pages are prerendered at build time with
 * the default branding, so the server snapshot is always the default one and
 * the runtime value takes over right after hydration (no hydration mismatch).
 */
export function useBranding(): Branding {
  return useSyncExternalStore(
    subscribe,
    readRuntimeBranding,
    getServerBranding,
  );
}
