import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("~/env", () => ({
  env: { NEXT_PUBLIC_AVATAR_BUCKET_NAME: "avatars" },
}));
vi.mock("@kan/api/trpc-context", () => ({
  createNextApiContext: vi.fn(),
}));
vi.mock("@kan/api/utils/apiLogging", () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock("@kan/api/utils/rateLimit", () => ({
  withRateLimit: (_options: unknown, handler: unknown) => handler,
}));
vi.mock("@kan/api/utils/permissions", () => ({
  assertPermission: vi.fn(),
}));
vi.mock("@kan/api/utils/workspaceImage", () => ({
  deleteWorkspaceImage: vi.fn(),
  getWorkspaceImageKeyPrefix: (workspacePublicId: string) =>
    `workspaces/${workspacePublicId}/`,
}));
vi.mock("@kan/db/repository/workspace.repo", () => ({
  getByPublicId: vi.fn(),
  updateImage: vi.fn(),
}));
vi.mock("@kan/logger", () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));
vi.mock("@kan/shared/utils", () => ({
  createS3Client: vi.fn(() => ({ send })),
  generateUID: vi.fn(() => "uid123456789"),
}));

const { createNextApiContext } = await import("@kan/api/trpc-context");
const { assertPermission } = await import("@kan/api/utils/permissions");
const { deleteWorkspaceImage } = await import("@kan/api/utils/workspaceImage");
const workspaceRepo = await import("@kan/db/repository/workspace.repo");
const handler = (await import("../pages/api/upload/workspace-avatar")).default;

const mockCreateContext = vi.mocked(createNextApiContext);
const mockAssertPermission = vi.mocked(assertPermission);
const mockDeleteWorkspaceImage = vi.mocked(deleteWorkspaceImage);
const mockGetByPublicId = vi.mocked(workspaceRepo.getByPublicId);
const mockUpdateImage = vi.mocked(workspaceRepo.updateImage);

const workspacePublicId = "workspace123";
const previousKey = `workspaces/${workspacePublicId}/old-workspace.png`;
const db = {};

function makeReqRes(query: Record<string, string> = { workspacePublicId }) {
  const body = Buffer.from("png-bytes");
  const req = Object.assign(Readable.from([body]), {
    method: "POST",
    query,
    headers: {
      "content-type": "image/png",
      "content-length": String(body.length),
      "x-original-filename": "workspace.png",
    },
  }) as unknown as NextApiRequest;
  const statusSpy = vi.fn().mockReturnThis();
  const jsonSpy = vi.fn();
  const res = {
    status: statusSpy,
    json: jsonSpy,
  } as unknown as NextApiResponse;
  return { req, res, statusSpy, jsonSpy };
}

describe("POST /api/upload/workspace-avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateContext.mockResolvedValue({
      user: { id: "user-1" },
      db,
    } as never);
    mockGetByPublicId.mockResolvedValue({
      id: 7,
      publicId: workspacePublicId,
      image: previousKey,
      deletedAt: null,
    } as never);
    mockAssertPermission.mockResolvedValue(undefined);
    mockUpdateImage.mockImplementation((_db, publicId, image) =>
      Promise.resolve({ publicId, image }),
    );
  });

  it("stores the image under the workspace prefix and drops the old one", async () => {
    const { req, res, statusSpy } = makeReqRes();
    await handler(req, res);

    const newKey = `workspaces/${workspacePublicId}/uid123456789-workspace.png`;
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(mockAssertPermission).toHaveBeenCalledWith(
      db,
      "user-1",
      7,
      "workspace:edit",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(mockUpdateImage).toHaveBeenCalledWith(db, workspacePublicId, newKey);
    expect(mockDeleteWorkspaceImage).toHaveBeenCalledWith(
      workspacePublicId,
      previousKey,
    );
  });

  it("rejects members without workspace:edit before uploading", async () => {
    mockAssertPermission.mockRejectedValue(new Error("FORBIDDEN"));

    const { req, res, statusSpy } = makeReqRes();
    await handler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(send).not.toHaveBeenCalled();
    expect(mockUpdateImage).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mockCreateContext.mockResolvedValue({ user: null, db } as never);

    const { req, res, statusSpy } = makeReqRes();
    await handler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown workspace", async () => {
    mockGetByPublicId.mockResolvedValue(undefined);

    const { req, res, statusSpy } = makeReqRes();
    await handler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("requires a valid workspacePublicId", async () => {
    const { req, res, statusSpy } = makeReqRes({});
    await handler(req, res);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(mockGetByPublicId).not.toHaveBeenCalled();
  });
});
