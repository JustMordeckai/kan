import { deleteObject } from "@kan/shared/utils";

/**
 * Workspace images live in the avatar bucket, next to user avatars, under a
 * prefix scoped to the workspace.
 */
export const getWorkspaceImageKeyPrefix = (workspacePublicId: string) =>
  `workspaces/${workspacePublicId}/`;

export const isWorkspaceImageKey = (
  workspacePublicId: string,
  imageKey: string | null | undefined,
): imageKey is string =>
  !!imageKey?.startsWith(getWorkspaceImageKeyPrefix(workspacePublicId));

/**
 * Best-effort removal of a previous workspace image. Only objects uploaded for
 * this workspace are deleted; failures are logged and never block the caller.
 */
export const deleteWorkspaceImage = async (
  workspacePublicId: string,
  imageKey: string | null | undefined,
) => {
  if (!isWorkspaceImageKey(workspacePublicId, imageKey)) return;

  const bucket = process.env.NEXT_PUBLIC_AVATAR_BUCKET_NAME;
  if (!bucket) return;

  try {
    await deleteObject(bucket, imageKey);
  } catch (error) {
    console.error(
      `Failed to delete workspace image from S3: ${imageKey}`,
      error,
    );
  }
};
