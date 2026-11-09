import { createHash, timingSafeEqual } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { withRateLimit } from "@kan/api/utils/rateLimit";
import {
  getDiscordRoleAccessConfig,
  getDiscordSyncSecret,
  syncAllDiscordUsers,
} from "@kan/auth/discord";
import { createDrizzleClient } from "@kan/db/client";
import { createLogger } from "@kan/logger";

const db = createDrizzleClient();
const log = createLogger("api");

let running = false;

// Hashing first keeps the comparison constant-time whatever the lengths.
const secretMatches = (provided: string, expected: string) =>
  timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const config = getDiscordRoleAccessConfig();
  const secret = getDiscordSyncSecret();

  if (!config || !secret) {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const provided = req.headers["x-sync-secret"];
  if (typeof provided !== "string" || !secretMatches(provided, secret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (running) {
    return res.status(409).json({ error: "Sync already running" });
  }

  running = true;
  try {
    const summary = await syncAllDiscordUsers(db, config);
    log.info(summary, "Discord role sync done");
    return res.status(200).json(summary);
  } catch (error) {
    log.error({ err: error }, "Discord role sync failed");
    return res.status(500).json({ error: "Sync failed" });
  } finally {
    running = false;
  }
}

export default withRateLimit({ points: 10, duration: 60 }, handler);
