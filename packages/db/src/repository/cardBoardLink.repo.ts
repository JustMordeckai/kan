import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardAttachments,
  cardBoardLinks,
  cards,
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

    if (removed) {
      await savePositions(
        tx,
        removed.listId,
        await getListEntries(tx, removed.listId),
      );
    }

    return removed;
  });
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
