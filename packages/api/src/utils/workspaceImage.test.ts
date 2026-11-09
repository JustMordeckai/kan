import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteObject } from "@kan/shared/utils";

import {
  deleteWorkspaceImage,
  getWorkspaceImageKeyPrefix,
  isWorkspaceImageKey,
} from "./workspaceImage";

vi.mock("@kan/shared/utils", () => ({
  deleteObject: vi.fn(),
}));

const mockDeleteObject = vi.mocked(deleteObject);
const workspacePublicId = "workspace123";

describe("workspace image keys", () => {
  it("scopes keys to the workspace", () => {
    expect(getWorkspaceImageKeyPrefix(workspacePublicId)).toBe(
      "workspaces/workspace123/",
    );
    expect(
      isWorkspaceImageKey(workspacePublicId, "workspaces/workspace123/a.png"),
    ).toBe(true);
    expect(
      isWorkspaceImageKey(workspacePublicId, "workspaces/otherspace12/a.png"),
    ).toBe(false);
    expect(isWorkspaceImageKey(workspacePublicId, "user-1/avatar.png")).toBe(
      false,
    );
    expect(isWorkspaceImageKey(workspacePublicId, null)).toBe(false);
  });
});

describe("deleteWorkspaceImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_AVATAR_BUCKET_NAME", "avatars");
  });

  it("deletes an image uploaded for the workspace", async () => {
    await deleteWorkspaceImage(
      workspacePublicId,
      "workspaces/workspace123/a.png",
    );

    expect(mockDeleteObject).toHaveBeenCalledWith(
      "avatars",
      "workspaces/workspace123/a.png",
    );
  });

  it("never deletes keys outside the workspace prefix", async () => {
    await deleteWorkspaceImage(workspacePublicId, "user-1/avatar.png");
    await deleteWorkspaceImage(
      workspacePublicId,
      "workspaces/otherspace12/a.png",
    );
    await deleteWorkspaceImage(workspacePublicId, "https://example.com/a.png");
    await deleteWorkspaceImage(workspacePublicId, null);

    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("does nothing when the avatar bucket is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_AVATAR_BUCKET_NAME", "");

    await deleteWorkspaceImage(
      workspacePublicId,
      "workspaces/workspace123/a.png",
    );

    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("swallows storage errors", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockDeleteObject.mockRejectedValueOnce(new Error("S3 down"));

    await expect(
      deleteWorkspaceImage(workspacePublicId, "workspaces/workspace123/a.png"),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
