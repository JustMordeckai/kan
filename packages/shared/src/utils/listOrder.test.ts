import { describe, expect, it } from "vitest";

import { insertAtPosition, mergeListOrder } from "./listOrder";

const own = (id: string) => ({ id });
const shared = (id: string, index: number) => ({ id, index });

describe("mergeListOrder", () => {
  it("keeps own cards in order when nothing is shared", () => {
    expect(mergeListOrder([own("a"), own("b")], [])).toEqual([
      own("a"),
      own("b"),
    ]);
  });

  it("places shared cards at their absolute position", () => {
    const result = mergeListOrder(
      [own("a"), own("b"), own("c")],
      [shared("y", 3), shared("x", 1)],
    );

    expect(result.map((item) => item.id)).toEqual(["a", "x", "b", "y", "c"]);
  });

  it("appends shared cards whose position is past the end", () => {
    const result = mergeListOrder([own("a")], [shared("x", 7), shared("y", 9)]);

    expect(result.map((item) => item.id)).toEqual(["a", "x", "y"]);
  });

  it("keeps colliding shared cards next to each other in input order", () => {
    const result = mergeListOrder(
      [own("a"), own("b")],
      [shared("x", 0), shared("y", 0)],
    );

    expect(result.map((item) => item.id)).toEqual(["x", "y", "a", "b"]);
  });
});

describe("insertAtPosition", () => {
  it("inserts at the given position", () => {
    expect(insertAtPosition(["a", "b"], "x", 1)).toEqual(["a", "x", "b"]);
  });

  it("appends when no position is given or it is out of range", () => {
    expect(insertAtPosition(["a"], "x", undefined)).toEqual(["a", "x"]);
    expect(insertAtPosition(["a"], "x", 5)).toEqual(["a", "x"]);
    expect(insertAtPosition(["a"], "x", -2)).toEqual(["x", "a"]);
  });
});
