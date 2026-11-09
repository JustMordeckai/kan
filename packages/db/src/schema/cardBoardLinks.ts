import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { boards } from "./boards";
import { cards } from "./cards";
import { lists } from "./lists";
import { users } from "./users";

/**
 * Shows a card on a board other than its own. The card keeps its home list;
 * on the linked board it sits in `listId` at `index`, its absolute position
 * in that list as displayed.
 */
export const cardBoardLinks = pgTable(
  "card_board_links",
  {
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    boardId: bigint("boardId", { mode: "number" })
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    listId: bigint("listId", { mode: "number" })
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.boardId] }),
    index("card_board_links_board_idx").on(table.boardId),
    index("card_board_links_list_idx").on(table.listId, table.index),
  ],
).enableRLS();

export const cardBoardLinksRelations = relations(cardBoardLinks, ({ one }) => ({
  card: one(cards, {
    fields: [cardBoardLinks.cardId],
    references: [cards.id],
    relationName: "cardBoardLinksCard",
  }),
  board: one(boards, {
    fields: [cardBoardLinks.boardId],
    references: [boards.id],
    relationName: "cardBoardLinksBoard",
  }),
  list: one(lists, {
    fields: [cardBoardLinks.listId],
    references: [lists.id],
    relationName: "cardBoardLinksList",
  }),
  createdBy: one(users, {
    fields: [cardBoardLinks.createdBy],
    references: [users.id],
    relationName: "cardBoardLinksCreatedByUser",
  }),
}));
