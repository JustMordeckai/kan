/**
 * A list shows its own cards and cards shared from other boards. Own cards
 * keep their relative order (their index); a shared card's index is its
 * absolute position in the list as displayed, and own cards fill the
 * remaining slots.
 */
export const mergeListOrder = <Own, Shared extends { index: number }>(
  own: Own[],
  shared: Shared[],
): (Own | Shared)[] => {
  const merged: (Own | Shared)[] = [...own];
  const sorted = [...shared].sort((a, b) => a.index - b.index);
  let previous = -1;

  for (const item of sorted) {
    const position = Math.min(
      Math.max(item.index, previous + 1, 0),
      merged.length,
    );
    merged.splice(position, 0, item);
    previous = position;
  }

  return merged;
};

/**
 * Inserts an item at a displayed position, clamped to the list bounds.
 */
export const insertAtPosition = <T>(
  items: T[],
  item: T,
  position: number | undefined,
): T[] => {
  const at =
    position === undefined
      ? items.length
      : Math.min(Math.max(position, 0), items.length);

  return [...items.slice(0, at), item, ...items.slice(at)];
};
