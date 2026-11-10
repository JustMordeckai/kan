import { describe, expect, it } from "vitest";

import { boardsForFilter, discordColourToHex } from "./memberBoardAccess";

describe("discordColourToHex", () => {
  it("turns a Discord colour integer into a hex colour", () => {
    expect(discordColourToHex(0xe74c3c)).toBe("#e74c3c");
    expect(discordColourToHex(0x0000ff)).toBe("#0000ff");
  });

  it("has no colour for 0, unknown or invalid values", () => {
    expect(discordColourToHex(0)).toBeNull();
    expect(discordColourToHex(null)).toBeNull();
    expect(discordColourToHex(undefined)).toBeNull();
    expect(discordColourToHex(-1)).toBeNull();
    expect(discordColourToHex(0x1000000)).toBeNull();
    expect(discordColourToHex(1.5)).toBeNull();
  });
});

describe("boardsForFilter", () => {
  const boards = [{ boardPublicId: "a" }, { boardPublicId: "b" }];

  it("keeps every board without a filter", () => {
    expect(boardsForFilter(boards, null)).toBe(boards);
  });

  it("keeps only the filtered board", () => {
    expect(boardsForFilter(boards, "b")).toEqual([{ boardPublicId: "b" }]);
  });

  it("returns null when the member cannot access the filtered board", () => {
    expect(boardsForFilter(boards, "c")).toBeNull();
  });
});
