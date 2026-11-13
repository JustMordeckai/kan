import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardMemberRepo from "@kan/db/repository/boardMember.repo";
import * as cardBoardLinkRepo from "@kan/db/repository/cardBoardLink.repo";
import * as permissionRepo from "@kan/db/repository/permission.repo";

import {
  assertCanEditCardLabel,
  assertCardAccess,
  filterBoardAssignable,
  filterCardAssignable,
  hasCardAccess,
} from "./permissions";

vi.mock("@kan/db/repository/boardMember.repo", () => ({
  getWorkspaceMemberIds: vi.fn(),
  getMembership: vi.fn(),
}));
vi.mock("@kan/db/repository/cardBoardLink.repo", () => ({
  getBoardsByCardId: vi.fn(),
}));
vi.mock("@kan/db/repository/member.repo", () => ({}));
vi.mock("@kan/db/repository/permission.repo", () => ({
  getMemberWithRole: vi.fn(),
}));

const db = {} as never;
const admin = { id: 1, role: "admin" };
const onBoard = { id: 2, role: "member" };
const offBoard = { id: 3, role: "member" };

describe("filterBoardAssignable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps workspace admins and board members on regular boards", async () => {
    vi.mocked(boardMemberRepo.getWorkspaceMemberIds).mockResolvedValueOnce([2]);

    await expect(
      filterBoardAssignable(db, { id: 9, type: "regular" }, [
        admin,
        onBoard,
        offBoard,
      ]),
    ).resolves.toEqual([admin, onBoard]);
  });

  it("leaves template boards open to the whole workspace", async () => {
    await expect(
      filterBoardAssignable(db, { id: 9, type: "template" }, [offBoard]),
    ).resolves.toEqual([offBoard]);
    expect(boardMemberRepo.getWorkspaceMemberIds).not.toHaveBeenCalled();
  });
});

describe("card access through shared boards", () => {
  const HOME_BOARD = 10;
  const SHARED_BOARD = 20;
  const OTHER_BOARD = 30;
  const card = {
    id: 5,
    boardId: HOME_BOARD,
    workspaceId: 1,
    boardType: "regular",
  };
  const sharedBoard = {
    id: SHARED_BOARD,
    publicId: "sharedboard1",
    name: "Shared",
    workspaceId: 1,
    type: "regular" as const,
    listId: 200,
    listPublicId: "sharedlist01",
    listName: "To do",
    externalUrl: null,
  };

  const memberOf = (...boardIds: number[]) =>
    vi
      .mocked(boardMemberRepo.getMembership)
      .mockImplementation((_db, { boardId }) =>
        Promise.resolve(
          boardIds.includes(boardId)
            ? { workspaceMemberId: 2, role: "member" as const }
            : undefined,
        ),
      );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(permissionRepo.getMemberWithRole).mockResolvedValue({
      id: 2,
      role: "member",
      roleId: null,
    } as never);
    vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([]);
  });

  it("grants access through the home board without reading links", async () => {
    memberOf(HOME_BOARD);

    await expect(hasCardAccess(db, "user", card)).resolves.toBe(true);
    expect(cardBoardLinkRepo.getBoardsByCardId).not.toHaveBeenCalled();
  });

  it("grants access through a board the card is shared on", async () => {
    memberOf(SHARED_BOARD);
    vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([
      sharedBoard,
    ]);

    await expect(hasCardAccess(db, "user", card)).resolves.toBe(true);
    await expect(assertCardAccess(db, "user", card)).resolves.toBeUndefined();
  });

  it("denies members of an unrelated board", async () => {
    memberOf(OTHER_BOARD);
    vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([
      sharedBoard,
    ]);

    await expect(hasCardAccess(db, "user", card)).resolves.toBe(false);
    await expect(assertCardAccess(db, "user", card)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("revokes access once the card is no longer shared", async () => {
    memberOf(SHARED_BOARD);
    vi.mocked(cardBoardLinkRepo.getBoardsByCardId)
      .mockResolvedValueOnce([sharedBoard])
      .mockResolvedValueOnce([]);

    await expect(hasCardAccess(db, "user", card)).resolves.toBe(true);
    await expect(hasCardAccess(db, "user", card)).resolves.toBe(false);
  });

  it("ignores links to another workspace or to a template", async () => {
    memberOf(SHARED_BOARD);
    vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([
      { ...sharedBoard, workspaceId: 2 },
      { ...sharedBoard, type: "template" },
    ]);

    await expect(hasCardAccess(db, "user", card)).resolves.toBe(false);
  });

  it("denies users outside the workspace", async () => {
    vi.mocked(permissionRepo.getMemberWithRole).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([
      sharedBoard,
    ]);

    await expect(hasCardAccess(db, "user", card)).resolves.toBe(false);
  });

  it("lets anyone on the home or a shared board be assigned", async () => {
    const onHome = { id: 4, role: "member" };
    const onShared = { id: 5, role: "member" };
    vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([
      sharedBoard,
    ]);
    vi.mocked(boardMemberRepo.getWorkspaceMemberIds).mockImplementation(
      (_db, boardId) => Promise.resolve(boardId === HOME_BOARD ? [4] : [5]),
    );

    await expect(
      filterCardAssignable(db, card, [admin, onHome, onShared, offBoard]),
    ).resolves.toEqual([admin, onHome, onShared]);
  });

  describe("assertCanEditCardLabel", () => {
    const homeLabel = { boardId: HOME_BOARD };
    const sharedLabel = { boardId: SHARED_BOARD };
    const otherLabel = { boardId: OTHER_BOARD };

    beforeEach(() => {
      vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([
        sharedBoard,
      ]);
    });

    it("lets home board members manage home labels without reading links", async () => {
      memberOf(HOME_BOARD);

      await expect(
        assertCanEditCardLabel(db, "user", card, homeLabel),
      ).resolves.toBeUndefined();
      expect(cardBoardLinkRepo.getBoardsByCardId).not.toHaveBeenCalled();
    });

    it("keeps home labels away from members of the shared board only", async () => {
      memberOf(SHARED_BOARD);

      await expect(
        assertCanEditCardLabel(db, "user", card, homeLabel),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lets shared board members manage that board's labels", async () => {
      memberOf(SHARED_BOARD);

      await expect(
        assertCanEditCardLabel(db, "user", card, sharedLabel),
      ).resolves.toBeUndefined();
    });

    it("keeps a shared board's labels away from home board members", async () => {
      memberOf(HOME_BOARD);

      await expect(
        assertCanEditCardLabel(db, "user", card, sharedLabel),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("falls back to the home board for a board the card is not shared on", async () => {
      memberOf(OTHER_BOARD);

      await expect(
        assertCanEditCardLabel(db, "user", card, otherLabel),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      memberOf(HOME_BOARD);

      // Allowed here; the repository then refuses the label's board.
      await expect(
        assertCanEditCardLabel(db, "user", card, otherLabel),
      ).resolves.toBeUndefined();
    });

    it("ignores a link once it no longer counts, like a template board", async () => {
      memberOf(SHARED_BOARD);
      vi.mocked(cardBoardLinkRepo.getBoardsByCardId).mockResolvedValue([
        { ...sharedBoard, type: "template" },
      ]);

      await expect(
        assertCanEditCardLabel(db, "user", card, sharedLabel),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
