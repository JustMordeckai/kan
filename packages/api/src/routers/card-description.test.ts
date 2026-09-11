import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";

import { sendMentionEmails } from "../utils/notifications";
import { assertCanEdit } from "../utils/permissions";
import {
  createCardWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
  getByPublicId: vi.fn(),
  update: vi.fn(),
  reorder: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  bulkCreate: vi.fn(),
}));
vi.mock("../utils/notifications", () => ({
  sendMentionEmails: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
  assertBoardAccess: vi.fn(),
  assertCardAccess: vi.fn(),
}));
vi.mock("../utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(() => ({})),
  sendWebhooksForWorkspace: vi.fn(() => Promise.resolve()),
}));

const mockDb = {} as never;
const cardPublicId = "card-12345678";
const ctx = {
  user: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  },
  db: mockDb,
} as never;

const mockExistingCard = (completed = false) => {
  vi.mocked(cardRepo.getByPublicId).mockResolvedValue({
    id: 1,
    publicId: cardPublicId,
    title: "Card",
    description: "<p>Existing description</p>",
    listId: 3,
    dueDate: null,
    externalUrl: null,
    completed,
    coverColourCode: null,
    coverAttachment: null,
    coverSize: "normal",
    list: {
      publicId: "list-12345678",
      name: "Todo",
    },
  });
};

const mockUpdatedCard = (completed = false) => {
  vi.mocked(cardRepo.update).mockResolvedValue({
    id: 1,
    publicId: cardPublicId,
    title: "Card",
    description: null,
    dueDate: null,
    externalUrl: null,
    completed,
  });
};

describe("card updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(assertCanEdit).mockResolvedValue(undefined);
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      id: 1,
      createdBy: "user-123",
      workspaceId: 2,
      workspaceVisibility: "private",
      listPublicId: "list-12345678",
      listName: "Todo",
      boardId: 5,
      boardType: "regular",
      boardPublicId: "board-1234567",
      boardName: "Board",
    });
    vi.mocked(cardActivityRepo.bulkCreate).mockResolvedValue([]);
    vi.mocked(sendWebhooksForWorkspace).mockResolvedValue(undefined);
  });

  it("stores an empty editor document as null", async () => {
    mockExistingCard();
    mockUpdatedCard();

    const { cardRouter } = await import("./card");

    await cardRouter.createCaller(ctx).update({
      cardPublicId,
      description: "<p></p>",
    });

    expect(cardRepo.update).toHaveBeenCalledWith(
      mockDb,
      { description: null },
      { cardPublicId },
    );
    expect(cardActivityRepo.bulkCreate).toHaveBeenCalledWith(mockDb, [
      expect.objectContaining({
        type: "card.updated.description",
        fromDescription: "<p>Existing description</p>",
        toDescription: undefined,
      }),
    ]);
    expect(sendMentionEmails).not.toHaveBeenCalled();
    expect(createCardWebhookPayload).toHaveBeenCalledWith(
      "card.updated",
      expect.objectContaining({ description: null }),
      expect.objectContaining({
        changes: {
          description: {
            from: "<p>Existing description</p>",
            to: null,
          },
        },
      }),
    );
  });

  it.each([
    {
      previous: false,
      completed: true,
      activityType: "card.updated.completed",
    },
    {
      previous: true,
      completed: false,
      activityType: "card.updated.uncompleted",
    },
  ] as const)(
    "records $activityType when completion changes",
    async ({ previous, completed, activityType }) => {
      mockExistingCard(previous);
      mockUpdatedCard(completed);

      const { cardRouter } = await import("./card");

      await cardRouter.createCaller(ctx).update({
        cardPublicId,
        completed,
      });

      expect(cardRepo.update).toHaveBeenCalledWith(
        mockDb,
        { completed },
        { cardPublicId },
      );
      expect(cardActivityRepo.bulkCreate).toHaveBeenCalledWith(mockDb, [
        {
          type: activityType,
          cardId: 1,
          createdBy: "user-123",
        },
      ]);
      expect(createCardWebhookPayload).toHaveBeenCalledWith(
        "card.updated",
        expect.objectContaining({ completed }),
        expect.objectContaining({
          changes: {
            completed: { from: previous, to: completed },
          },
        }),
      );
    },
  );

  it("does not create activity when completion is unchanged", async () => {
    mockExistingCard();
    mockUpdatedCard();

    const { cardRouter } = await import("./card");

    await cardRouter.createCaller(ctx).update({
      cardPublicId,
      completed: false,
    });

    expect(cardActivityRepo.bulkCreate).not.toHaveBeenCalled();
    expect(createCardWebhookPayload).toHaveBeenCalledWith(
      "card.updated",
      expect.anything(),
      expect.objectContaining({ changes: undefined }),
    );
  });
});
