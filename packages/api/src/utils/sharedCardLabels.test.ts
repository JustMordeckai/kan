import { describe, expect, it } from "vitest";

import { labelsOfBoard } from "@kan/db/repository/board.repo";
import { getCardLabelViolation } from "@kan/db/repository/card.repo";

const HOME_BOARD = 10;
const SHARED_BOARD = 20;
const OTHER_BOARD = 30;

describe("getCardLabelViolation", () => {
  const card = { homeBoardId: HOME_BOARD, sharedBoardIds: [SHARED_BOARD] };
  const label = (boardId: number, deletedAt: Date | null = null) => ({
    boardId,
    deletedAt,
  });

  it("accepts labels of the home board and of boards the card is shared on", () => {
    expect(getCardLabelViolation(card, label(HOME_BOARD))).toBeNull();
    expect(getCardLabelViolation(card, label(SHARED_BOARD))).toBeNull();
  });

  it("refuses labels of any other board", () => {
    expect(getCardLabelViolation(card, label(OTHER_BOARD))).toBe(
      "board_mismatch",
    );
    expect(
      getCardLabelViolation(
        { homeBoardId: HOME_BOARD, sharedBoardIds: [] },
        label(SHARED_BOARD),
      ),
    ).toBe("board_mismatch");
  });

  it("treats deleted and unknown labels as not found", () => {
    expect(getCardLabelViolation(card, label(SHARED_BOARD, new Date()))).toBe(
      "label_not_found",
    );
    expect(getCardLabelViolation(card, undefined)).toBe("label_not_found");
  });

  it("fails closed on an unknown card", () => {
    expect(getCardLabelViolation(undefined, label(HOME_BOARD))).toBe(
      "card_not_found",
    );
  });
});

describe("labelsOfBoard", () => {
  const cardLabels: {
    label: {
      publicId: string;
      name: string;
      colourCode: string | null;
      boardId: number;
    };
  }[] = [
    {
      label: {
        publicId: "lbhome000001",
        name: "Bug",
        colourCode: null,
        boardId: HOME_BOARD,
      },
    },
    {
      label: {
        publicId: "lbshared0001",
        name: "From dev",
        colourCode: "#fff",
        boardId: SHARED_BOARD,
      },
    },
  ];

  it("keeps the labels of one board, without their board id", () => {
    expect(labelsOfBoard(cardLabels, SHARED_BOARD)).toEqual([
      { publicId: "lbshared0001", name: "From dev", colourCode: "#fff" },
    ]);
    expect(labelsOfBoard(cardLabels, HOME_BOARD)).toEqual([
      { publicId: "lbhome000001", name: "Bug", colourCode: null },
    ]);
    expect(labelsOfBoard(cardLabels, OTHER_BOARD)).toEqual([]);
  });
});
