import { createHash } from "node:crypto";

export const formatBoardBackground = (board: {
  backgroundColourCode: string | null;
  backgroundImageKey: string | null;
  backgroundImageUrl?: string | null;
}) => {
  if (board.backgroundImageKey) {
    return {
      kind: "image" as const,
      version: createHash("sha256")
        .update(board.backgroundImageKey)
        .digest("hex")
        .slice(0, 16),
    };
  }

  // External images are shown as-is: there are no stored previews for them.
  if (board.backgroundImageUrl) {
    return {
      kind: "url" as const,
      url: board.backgroundImageUrl,
    };
  }

  if (board.backgroundColourCode) {
    return {
      kind: "colour" as const,
      colourCode: board.backgroundColourCode,
    };
  }

  return null;
};
