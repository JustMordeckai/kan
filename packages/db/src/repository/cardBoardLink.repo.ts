import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardAttachments,
  cardBoardLinks,
  cards,
  cardsToLabels,
  labels,
  lists,
} from "@kan/db/schema";
import { insertAtPosition, mergeListOrder } from "@kan/shared/utils";

type DbTransaction = Parameters<Parameters<dbClient["transaction"]>[0]>[0];
type DbOrTransaction = dbClient | DbTransaction;

export interface ListEntry {
  cardId: number;
  shared: boolean;
}

const homeLists = alias(lists, "home_list");
const homeBoards = alias(boards, "home_board");

// A link only shows while its card, the card's home list and board, and the
// linked board and list all exist, and both boards share a workspace.
const visibleLinkConditions = () =>
  and(
    isNull(cards.deletedAt),
    isNull(homeLists.deletedAt),
    isNull(homeBoards.deletedAt),
    isNull(boards.deletedAt),
    isNull(lists.deletedAt),
    eq(homeBoards.workspaceId, boards.workspaceId),
  );

/**
 * Boards (other than its home board) a card is currently shown on.
 */
export const getBoardsByCardId = (db: DbOrTransaction, cardId: number) => {
  return db
    .select({
      id: boards.id,
      publicId: boards.publicId,
      name: boards.name,
      workspaceId: boards.workspaceId,
      type: boards.type,
      listId: lists.id,
      listPublicId: lists.publicId,
      listName: lists.name,
    })
    .from(cardBoardLinks)
    .innerJoin(cards, eq(cards.id, cardBoardLinks.cardId))
    .innerJoin(homeLists, eq(homeLists.id, cards.listId))
    .innerJoin(homeBoards, eq(homeBoards.id, homeLists.boardId))
    .innerJoin(boards, eq(boards.id, cardBoardLinks.boardId))
    .innerJoin(lists, eq(lists.id, cardBoardLinks.listId))
    .where(and(eq(cardBoardLinks.cardId, cardId), visibleLinkConditions()))
    .orderBy(asc(boards.name));
};

/**
 * Boards each of the given cards is currently shown on, its home board
 * excluded. With `lock`, the links are read FOR SHARE so they cannot be
 * removed until the caller's transaction ends.
 */
export const getVisibleLinks = (
  db: DbOrTransaction,
  cardIds: number[],
  options: { lock?: boolean } = {},
) => {
  if (!cardIds.length) return Promise.resolve([]);

  const query = db
    .select({ cardId: cardBoardLinks.cardId, boardId: cardBoardLinks.boardId })
    .from(cardBoardLinks)
    .innerJoin(cards, eq(cards.id, cardBoardLinks.cardId))
    .innerJoin(homeLists, eq(homeLists.id, cards.listId))
    .innerJoin(homeBoards, eq(homeBoards.id, homeLists.boardId))
    .innerJoin(boards, eq(boards.id, cardBoardLinks.boardId))
    .innerJoin(lists, eq(lists.id, cardBoardLinks.listId))
    .where(
      and(inArray(cardBoardLinks.cardId, cardIds), visibleLinkConditions()),
    )
    .orderBy(asc(cardBoardLinks.cardId), asc(cardBoardLinks.boardId));

  return options.lock ? query.for("share", { of: cardBoardLinks }) : query;
};

export const getByCardAndBoard = async (
  db: DbOrTransaction,
  args: { cardId: number; boardId: number },
) => {
  const [link] = await db
    .select({
      cardId: cardBoardLinks.cardId,
      boardId: cardBoardLinks.boardId,
      listId: cardBoardLinks.listId,
      index: cardBoardLinks.index,
    })
    .from(cardBoardLinks)
    .where(
      and(
        eq(cardBoardLinks.cardId, args.cardId),
        eq(cardBoardLinks.boardId, args.boardId),
      ),
    );

  return link;
};

/**
 * Cards shared onto a board, with the board they come from.
 */
export const getSharedCardsByBoardId = (
  db: DbOrTransaction,
  boardId: number,
) => {
  return db
    .select({
      cardId: cardBoardLinks.cardId,
      listId: cardBoardLinks.listId,
      index: cardBoardLinks.index,
      homeBoardId: homeBoards.id,
      homeBoardPublicId: homeBoards.publicId,
      homeBoardName: homeBoards.name,
    })
    .from(cardBoardLinks)
    .innerJoin(cards, eq(cards.id, cardBoardLinks.cardId))
    .innerJoin(homeLists, eq(homeLists.id, cards.listId))
    .innerJoin(homeBoards, eq(homeBoards.id, homeLists.boardId))
    .innerJoin(boards, eq(boards.id, cardBoardLinks.boardId))
    .innerJoin(lists, eq(lists.id, cardBoardLinks.listId))
    .where(and(eq(cardBoardLinks.boardId, boardId), visibleLinkConditions()))
    .orderBy(
      asc(cardBoardLinks.index),
      asc(cardBoardLinks.createdAt),
      asc(cardBoardLinks.cardId),
    );
};

/**
 * Every card shown in a list, own and shared, in display order.
 */
export const getListEntries = async (
  db: DbOrTransaction,
  listId: number,
): Promise<ListEntry[]> => {
  const own = await db
    .select({ cardId: cards.id })
    .from(cards)
    .where(and(eq(cards.listId, listId), isNull(cards.deletedAt)))
    .orderBy(asc(cards.index), asc(cards.id));

  const shared = await db
    .select({ cardId: cardBoardLinks.cardId, index: cardBoardLinks.index })
    .from(cardBoardLinks)
    .innerJoin(cards, eq(cards.id, cardBoardLinks.cardId))
    .innerJoin(homeLists, eq(homeLists.id, cards.listId))
    .innerJoin(homeBoards, eq(homeBoards.id, homeLists.boardId))
    .innerJoin(boards, eq(boards.id, cardBoardLinks.boardId))
    .innerJoin(lists, eq(lists.id, cardBoardLinks.listId))
    .where(and(eq(cardBoardLinks.listId, listId), visibleLinkConditions()))
    .orderBy(
      asc(cardBoardLinks.index),
      asc(cardBoardLinks.createdAt),
      asc(cardBoardLinks.cardId),
    );

  return mergeListOrder<ListEntry, ListEntry & { index: number }>(
    own.map(({ cardId }) => ({ cardId, shared: false })),
    shared.map(({ cardId, index }) => ({ cardId, shared: true, index })),
  ).map(({ cardId, shared }) => ({ cardId, shared }));
};

/**
 * Stores each shared card's displayed position so the list keeps the order
 * given by `entries`.
 */
export const savePositions = async (
  db: DbOrTransaction,
  listId: number,
  entries: ListEntry[],
) => {
  for (const [position, entry] of entries.entries()) {
    if (!entry.shared) continue;

    await db
      .update(cardBoardLinks)
      .set({ index: position })
      .where(
        and(
          eq(cardBoardLinks.cardId, entry.cardId),
          eq(cardBoardLinks.listId, listId),
        ),
      );
  }
};

/**
 * Position of a card among the list's own cards once it is shown at
 * `position`, and the resulting display order.
 */
export const placeOwnCard = async (
  db: DbOrTransaction,
  args: { cardId: number; listId: number; position: number | undefined },
) => {
  const entries = (await getListEntries(db, args.listId)).filter(
    (entry) => entry.shared || entry.cardId !== args.cardId,
  );
  const placed = insertAtPosition(
    entries,
    { cardId: args.cardId, shared: false },
    args.position,
  );
  const ownIndex = placed
    .slice(
      0,
      placed.findIndex(
        (entry) => !entry.shared && entry.cardId === args.cardId,
      ),
    )
    .filter((entry) => !entry.shared).length;

  return {
    entries: placed,
    ownIndex,
    hasShared: entries.some((e) => e.shared),
  };
};

export const create = async (
  db: dbClient,
  args: { cardId: number; boardId: number; listId: number; createdBy: string },
) => {
  return db.transaction(async (tx) => {
    const entries = await getListEntries(tx, args.listId);

    const [link] = await tx
      .insert(cardBoardLinks)
      .values({ ...args, index: entries.length })
      .onConflictDoUpdate({
        target: [cardBoardLinks.cardId, cardBoardLinks.boardId],
        set: {
          listId: args.listId,
          index: entries.length,
          createdBy: args.createdBy,
          createdAt: new Date(),
        },
      })
      .returning({
        cardId: cardBoardLinks.cardId,
        boardId: cardBoardLinks.boardId,
        listId: cardBoardLinks.listId,
        index: cardBoardLinks.index,
      });

    return link;
  });
};

/**
 * Moves a shared card within the board it is shared on. Only the link moves;
 * the card stays where it is on its home board.
 */
export const move = async (
  db: dbClient,
  args: {
    cardId: number;
    boardId: number;
    listId: number;
    position: number | undefined;
  },
) => {
  return db.transaction(async (tx) => {
    const link = await getByCardAndBoard(tx, args);

    if (!link) return undefined;

    const entries = (await getListEntries(tx, args.listId)).filter(
      (entry) => !entry.shared || entry.cardId !== args.cardId,
    );
    const placed = insertAtPosition(
      entries,
      { cardId: args.cardId, shared: true },
      args.position,
    );

    await tx
      .update(cardBoardLinks)
      .set({ listId: args.listId })
      .where(
        and(
          eq(cardBoardLinks.cardId, args.cardId),
          eq(cardBoardLinks.boardId, args.boardId),
        ),
      );

    await savePositions(tx, args.listId, placed);

    if (link.listId !== args.listId) {
      await savePositions(
        tx,
        link.listId,
        await getListEntries(tx, link.listId),
      );
    }

    return { ...link, listId: args.listId };
  });
};

/**
 * Stops showing a card on a board. The labels of that board only make sense
 * there, so they come off the card in the same transaction; the ids of the
 * removed labels are returned for the activity log.
 */
export const remove = async (
  db: dbClient,
  args: { cardId: number; boardId: number },
) => {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(cardBoardLinks)
      .where(
        and(
          eq(cardBoardLinks.cardId, args.cardId),
          eq(cardBoardLinks.boardId, args.boardId),
        ),
      )
      .returning({
        cardId: cardBoardLinks.cardId,
        boardId: cardBoardLinks.boardId,
        listId: cardBoardLinks.listId,
      });

    if (!removed) return undefined;

    const removedLabels = await removeBoardLabels(tx, args);

    await savePositions(
      tx,
      removed.listId,
      await getListEntries(tx, removed.listId),
    );

    return {
      ...removed,
      removedLabelIds: removedLabels.map((label) => label.labelId),
    };
  });
};

/**
 * Makes a board the card is shared on its home board. The card moves into
 * the list it was shared in, at the place it was shown there, and stays
 * shown on its previous home board as a shared card, at the place it had
 * there: both boards look the same afterwards. The card's labels stay as
 * they are, since a card carries the labels of its home board and of the
 * boards it is shared on. Returns undefined when the card is not shared on
 * that board.
 */
export const setHomeBoard = async (
  db: dbClient,
  args: { cardId: number; boardId: number; createdBy: string },
) => {
  return db.transaction(async (tx) => {
    const [card] = await tx
      .select({
        id: cards.id,
        listId: cards.listId,
        boardId: lists.boardId,
      })
      .from(cards)
      .innerJoin(lists, eq(lists.id, cards.listId))
      .where(and(eq(cards.id, args.cardId), isNull(cards.deletedAt)))
      .for("update", { of: cards });

    const link = await getByCardAndBoard(tx, args);

    if (!card || !link || link.boardId === card.boardId) return undefined;

    // The card's place on its previous home list becomes the shared copy's.
    const previousEntries = (await getListEntries(tx, card.listId)).map(
      (entry) =>
        !entry.shared && entry.cardId === card.id
          ? { cardId: card.id, shared: true }
          : entry,
    );
    const previousPosition = previousEntries.findIndex(
      (entry) => entry.shared && entry.cardId === card.id,
    );
    const position = (await getListEntries(tx, link.listId)).findIndex(
      (entry) => entry.shared && entry.cardId === card.id,
    );

    await tx
      .delete(cardBoardLinks)
      .where(
        and(
          eq(cardBoardLinks.cardId, card.id),
          eq(cardBoardLinks.boardId, link.boardId),
        ),
      );

    const placement = await placeOwnCard(tx, {
      cardId: card.id,
      listId: link.listId,
      position: position === -1 ? undefined : position,
    });

    // Own cards are renumbered in display order on both lists, so their
    // indices stay contiguous once the card has left one for the other.
    await tx
      .update(cards)
      .set({ listId: link.listId })
      .where(eq(cards.id, card.id));
    await saveOwnPositions(tx, link.listId, placement.entries);
    await saveOwnPositions(
      tx,
      card.listId,
      previousEntries.filter(
        (entry) => entry.shared || entry.cardId !== card.id,
      ),
    );

    await tx
      .insert(cardBoardLinks)
      .values({
        cardId: card.id,
        boardId: card.boardId,
        listId: card.listId,
        index: Math.max(previousPosition, 0),
        createdBy: args.createdBy,
      })
      .onConflictDoUpdate({
        target: [cardBoardLinks.cardId, cardBoardLinks.boardId],
        set: {
          listId: card.listId,
          index: Math.max(previousPosition, 0),
          createdBy: args.createdBy,
          createdAt: new Date(),
        },
      });

    await savePositions(tx, link.listId, placement.entries);
    await savePositions(tx, card.listId, previousEntries);

    return {
      cardId: card.id,
      boardId: link.boardId,
      listId: link.listId,
      previousBoardId: card.boardId,
      previousListId: card.listId,
    };
  });
};

/**
 * Numbers a list's own cards in the order given by `entries`.
 */
const saveOwnPositions = async (
  db: DbOrTransaction,
  listId: number,
  entries: ListEntry[],
) => {
  const own = entries.filter((entry) => !entry.shared);

  for (const [index, entry] of own.entries()) {
    await db
      .update(cards)
      .set({ index })
      .where(and(eq(cards.id, entry.cardId), eq(cards.listId, listId)));
  }
};

/**
 * Cover attachments, among the given ones, of cards currently shared onto a
 * board. Used to resolve cover previews of shared cards on that board.
 */
export const getSelectedSharedCoverAttachments = async (
  db: DbOrTransaction,
  args: { boardId: number; attachmentPublicIds: string[] },
) => {
  if (args.attachmentPublicIds.length === 0) return [];

  return db
    .select({ publicId: cardAttachments.publicId })
    .from(cardBoardLinks)
    .innerJoin(cards, eq(cards.id, cardBoardLinks.cardId))
    .innerJoin(cardAttachments, eq(cardAttachments.id, cards.coverAttachmentId))
    .innerJoin(homeLists, eq(homeLists.id, cards.listId))
    .innerJoin(homeBoards, eq(homeBoards.id, homeLists.boardId))
    .innerJoin(boards, eq(boards.id, cardBoardLinks.boardId))
    .innerJoin(lists, eq(lists.id, cardBoardLinks.listId))
    .where(
      and(
        eq(cardBoardLinks.boardId, args.boardId),
        visibleLinkConditions(),
        isNull(cardAttachments.deletedAt),
        inArray(cardAttachments.publicId, args.attachmentPublicIds),
      ),
    );
};

/**
 * Takes the labels of a board off a card. Never call it for the card's home
 * board: those labels belong to the card wherever it is shown.
 */
export const removeBoardLabels = (
  db: DbOrTransaction,
  args: { cardId: number; boardId: number },
) => {
  return db
    .delete(cardsToLabels)
    .where(
      and(
        eq(cardsToLabels.cardId, args.cardId),
        inArray(
          cardsToLabels.labelId,
          db
            .select({ id: labels.id })
            .from(labels)
            .where(eq(labels.boardId, args.boardId)),
        ),
      ),
    )
    .returning({ labelId: cardsToLabels.labelId });
};
