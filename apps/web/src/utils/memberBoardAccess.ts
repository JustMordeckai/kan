/** Discord stores role colours as RGB integers, 0 meaning "no colour". */
export const discordColourToHex = (colour: number | null | undefined) => {
  if (!colour || !Number.isInteger(colour) || colour < 0 || colour > 0xffffff)
    return null;

  return `#${colour.toString(16).padStart(6, "0")}`;
};

/**
 * Boards to show for a member: all of them, or only the filtered board.
 * Returns null when the member cannot access the filtered board, so the
 * member can be hidden.
 */
export const boardsForFilter = <T extends { boardPublicId: string }>(
  boards: T[],
  boardPublicId: string | null,
): T[] | null => {
  if (!boardPublicId) return boards;

  const matching = boards.filter(
    (board) => board.boardPublicId === boardPublicId,
  );

  return matching.length ? matching : null;
};
