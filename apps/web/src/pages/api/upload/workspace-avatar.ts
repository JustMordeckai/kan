import type { NextApiRequest, NextApiResponse } from "next";
import type { Readable } from "node:stream";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { createNextApiContext } from "@kan/api/trpc-context";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import { assertPermission } from "@kan/api/utils/permissions";
import { withRateLimit } from "@kan/api/utils/rateLimit";
import {
  deleteWorkspaceImage,
  getWorkspaceImageKeyPrefix,
} from "@kan/api/utils/workspaceImage";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { createLogger } from "@kan/logger";
import { createS3Client, generateUID } from "@kan/shared/utils";

import { env } from "~/env";

// Same limit as user avatars, default 2MB
const MAX_SIZE_BYTES =
  // eslint-disable-next-line no-restricted-properties
  Number.parseInt(process.env.S3_AVATAR_UPLOAD_LIMIT ?? "", 10) || 2097152;
const allowedContentTypes = ["image/jpeg", "image/png", "image/webp"];

const log = createLogger("api");

async function buffer(readable: Readable, maxSizeBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of readable as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > maxSizeBytes) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default withRateLimit(
  { points: 100, duration: 60 },
  withApiLogging(async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const { user, db } = await createNextApiContext(req);

      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const bucket = env.NEXT_PUBLIC_AVATAR_BUCKET_NAME;
      if (!bucket) {
        return res.status(500).json({ error: "Avatar bucket not configured" });
      }

      const workspacePublicId = req.query.workspacePublicId;
      if (
        typeof workspacePublicId !== "string" ||
        workspacePublicId.length < 12
      ) {
        return res.status(400).json({ error: "Invalid workspacePublicId" });
      }

      const contentType = req.headers["content-type"];
      const contentLengthHeader = req.headers["content-length"];
      const contentLength = contentLengthHeader
        ? Number.parseInt(contentLengthHeader, 10)
        : NaN;

      if (typeof contentType !== "string") {
        return res.status(400).json({ error: "Missing content type" });
      }

      if (!allowedContentTypes.includes(contentType)) {
        return res.status(400).json({ error: "Invalid content type" });
      }

      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return res
          .status(400)
          .json({ error: "Missing or invalid content length" });
      }

      if (contentLength > MAX_SIZE_BYTES) {
        return res.status(400).json({ error: "File too large" });
      }

      const workspace = await workspaceRepo.getByPublicId(
        db,
        workspacePublicId,
      );

      if (!workspace || workspace.deletedAt) {
        return res.status(404).json({ error: "Workspace not found" });
      }

      // Only members allowed to edit the workspace settings can change its image
      try {
        await assertPermission(db, user.id, workspace.id, "workspace:edit");
      } catch {
        return res.status(403).json({ error: "Permission denied" });
      }

      const rawFilenameHeader =
        (req.headers["x-original-filename"] as string | undefined) ?? "file";
      const originalFilenameHeader = (() => {
        try {
          return decodeURIComponent(rawFilenameHeader);
        } catch {
          return rawFilenameHeader;
        }
      })();

      const sanitizedFilename = originalFilenameHeader
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .substring(0, 200);

      const s3Key = `${getWorkspaceImageKeyPrefix(workspace.publicId)}${generateUID()}-${sanitizedFilename}`;

      const body = await buffer(req, MAX_SIZE_BYTES);

      if (!body) {
        return res.status(400).json({ error: "File too large" });
      }

      const client = createS3Client();

      // Upload the file to S3
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      );

      // Store the new key, then drop the image it replaces
      const updatedWorkspace = await workspaceRepo.updateImage(
        db,
        workspace.publicId,
        s3Key,
      );
      await deleteWorkspaceImage(workspace.publicId, workspace.image);

      return res.status(200).json({
        key: s3Key,
        filename: sanitizedFilename,
        contentType,
        size: body.length,
        workspace: updatedWorkspace,
      });
    } catch (error) {
      log.error({ err: error }, "Workspace image upload failed");
      return res.status(500).json({ error: "Internal server error" });
    }
  }),
);
