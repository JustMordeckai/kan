import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { getDefaultPermissions } from "@kan/shared";
import { generateAvatarUrl } from "@kan/shared/utils";

import { assertPermission } from "../utils/permissions";
import { deleteWorkspaceImage } from "../utils/workspaceImage";

vi.mock("@kan/db/repository/boardMember.repo", () => ({}));
vi.mock("@kan/db/repository/subscription.repo", () => ({}));
vi.mock("@kan/db/repository/workspace.repo", () => ({
  getAllByUserId: vi.fn(),
  getByPublicId: vi.fn(),
  updateImage: vi.fn(),
}));
vi.mock("@kan/db/repository/workspaceSlug.repo", () => ({}));
vi.mock("@kan/db/client", () => ({
  createDrizzleClient: vi.fn(() => ({})),
}));
vi.mock("@kan/auth/server", () => ({
  initAuth: vi.fn(() => ({ api: {} })),
}));
vi.mock("@kan/shared/utils", () => ({
  generateAvatarUrl: vi.fn(),
  generateUID: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({
  assertPermission: vi.fn(),
  isWorkspaceAdmin: vi.fn(),
}));
vi.mock("../utils/workspaceImage", () => ({
  deleteWorkspaceImage: vi.fn(),
}));

const mockGetAllByUserId = vi.mocked(workspaceRepo.getAllByUserId);
const mockGetByPublicId = vi.mocked(workspaceRepo.getByPublicId);
const mockUpdateImage = vi.mocked(workspaceRepo.updateImage);
const mockGenerateAvatarUrl = vi.mocked(generateAvatarUrl);
const mockAssertPermission = vi.mocked(assertPermission);
const mockDeleteWorkspaceImage = vi.mocked(deleteWorkspaceImage);

const workspacePublicId = "workspace123";
const imageKey = `workspaces/${workspacePublicId}/abc-workspace.png`;
const signedImageUrl = "https://example.com/signed/workspace.png";
const db = {};
const ctx = {
  db,
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
  },
} as never;

const createMembership = (publicId: string, image: string | null) => ({
  role: "admin",
  workspace: {
    publicId,
    name: `Workspace ${publicId}`,
    description: null,
    image,
    slug: publicId,
    plan: "free" as const,
    weekStartDay: 1,
    cardPrefix: "KAN",
    deletedAt: null,
  },
});

describe("workspace image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertPermission.mockResolvedValue(undefined);
    mockGenerateAvatarUrl.mockResolvedValue(signedImageUrl);
  });

  describe("all", () => {
    it("resolves stored image keys to URLs and keeps null images", async () => {
      mockGetAllByUserId.mockResolvedValue([
        createMembership(workspacePublicId, imageKey),
        createMembership("workspace456", null),
      ] as never);

      const { workspaceRouter } = await import("./workspace");
      const result = await workspaceRouter.createCaller(ctx).all();

      expect(result.map((member) => member.workspace.image)).toEqual([
        signedImageUrl,
        null,
      ]);
      expect(mockGenerateAvatarUrl).toHaveBeenCalledTimes(1);
      expect(mockGenerateAvatarUrl).toHaveBeenCalledWith(imageKey);
    });
  });

  describe("removeImage", () => {
    it("requires workspace:edit, clears the key and deletes the object", async () => {
      mockGetByPublicId.mockResolvedValue({
        id: 7,
        publicId: workspacePublicId,
        image: imageKey,
      } as never);

      const { workspaceRouter } = await import("./workspace");
      const result = await workspaceRouter
        .createCaller(ctx)
        .removeImage({ workspacePublicId });

      expect(result).toEqual({ success: true });
      expect(mockAssertPermission).toHaveBeenCalledWith(
        db,
        "user-1",
        7,
        "workspace:edit",
      );
      expect(mockUpdateImage).toHaveBeenCalledWith(db, workspacePublicId, null);
      expect(mockDeleteWorkspaceImage).toHaveBeenCalledWith(
        workspacePublicId,
        imageKey,
      );
    });

    it("does not touch the image without permission", async () => {
      mockGetByPublicId.mockResolvedValue({
        id: 7,
        publicId: workspacePublicId,
        image: imageKey,
      } as never);
      mockAssertPermission.mockRejectedValue(
        new TRPCError({ code: "FORBIDDEN", message: "Permission denied" }),
      );

      const { workspaceRouter } = await import("./workspace");

      await expect(
        workspaceRouter.createCaller(ctx).removeImage({ workspacePublicId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mockUpdateImage).not.toHaveBeenCalled();
      expect(mockDeleteWorkspaceImage).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND for an unknown workspace", async () => {
      mockGetByPublicId.mockResolvedValue(undefined);

      const { workspaceRouter } = await import("./workspace");

      await expect(
        workspaceRouter.createCaller(ctx).removeImage({ workspacePublicId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mockUpdateImage).not.toHaveBeenCalled();
    });
  });

  it("is editable by admins only with the default roles", () => {
    expect(getDefaultPermissions("admin")).toContain("workspace:edit");
    expect(getDefaultPermissions("member")).not.toContain("workspace:edit");
    expect(getDefaultPermissions("guest")).not.toContain("workspace:edit");
  });
});
