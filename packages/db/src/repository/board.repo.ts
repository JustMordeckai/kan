import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { BoardVisibilityStatus } from "@kan/db/schema";
import {
  boardMembers,
  boards,
  cardActivities,
  cardAttachments,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
  userBoardFavorites,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import {
  generateUID,
  mergeListOrder,
  normalizeDescription,
} from "@kan/shared/utils";

import * as boardMemberRepo from "./boardMember.repo";
import * as cardBoardLinkRepo from "./cardBoardLink.repo";

export const getCount = async (db: dbClient) => {
  const result = await db
    .select({ count: count() })
    .from(boards)
    .where(isNull(boards.deletedAt));

  return result[0]?.count ?? 0;
};

export const getAllByWorkspaceId = async (
  db: dbClient,
  workspaceId: number,
  userId: string,
  opts?: {
    type?: "regular" | "template";
    archived?: boolean;
    isWorkspaceAdmin?: boolean;
  },
) => {
  // Templates stay visible to the whole workspace; regular boards (public
  // or private) are scoped to explicit board membership unless the user is
  // a workspace admin. Public only means "viewable via the share link".
  const memberBoardIds = opts?.isWorkspaceAdmin
    ? undefined
    : await boardMemberRepo.getMemberBoardIds(db, { workspaceId, userId });

  const boardsData = await db.query.boards.findMany({
    columns: {
      publicId: true,
      name: true,
      backgroundColourCode: true,
      backgroundImageKey: true,
      backgroundImageUrl: true,
    },
    with: {
      userFavorites: {
        where: eq(userBoardFavorites.userId, userId),
        columns: {
          userId: true,
        },
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          index: true,
        },
        orderBy: [asc(lists.index)],
      },
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
      },
    },
    where: and(
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
      opts?.type ? eq(boards.type, opts.type) : undefined,
      opts?.archived !== undefined
        ? eq(boards.isArchived, opts.archived)
        : undefined,
      memberBoardIds
        ? or(eq(boards.type, "template"), inArray(boards.id, memberBoardIds))
        : undefined,
    ),
  });

  // Transform and sort: favorites first, then alphabetically
  return boardsData
    .map((board) => ({
      ...board,
      favorite: board.userFavorites.length > 0,
      userFavorites: undefined,
    }))
    .sort((a, b) => {
      // Sort favorites first
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      // Then alphabetically by name
      return a.name.localeCompare(b.name);
    });
};

export const getIdByPublicId = async (db: dbClient, boardPublicId: string) => {
  const board = await db.query.boards.findFirst({
    columns: {
      id: true,
      type: true,
      isArchived: true,
    },
    where: eq(boards.publicId, boardPublicId),
  });

  return board;
};

interface DueDateFilter {
  startDate?: Date;
  endDate?: Date;
  hasNoDueDate?: boolean;
}

const buildDueDateWhere = (filters: DueDateFilter[]) => {
  if (!filters.length) return undefined;

  const clauses = filters
    .map((filter) => {
      const conditions: ReturnType<typeof and>[] = [];

      if (filter.hasNoDueDate) {
        conditions.push(isNull(cards.dueDate));
      } else {
        conditions.push(isNotNull(cards.dueDate));

        if (filter.startDate)
          conditions.push(gte(cards.dueDate, filter.startDate));

        if (filter.endDate) conditions.push(lt(cards.dueDate, filter.endDate));
      }

      return conditions.length > 0 ? and(...conditions) : undefined;
    })
    .filter((clause): clause is NonNullable<typeof clause> => !!clause);

  if (!clauses.length) return undefined;

  return or(...clauses);
};

/**
 * The labels of a card that belong to one board. A card carries its home
 * board's labels plus those of every board it is shared on, and each board
 * only shows its own.
 */
export const labelsOfBoard = <
  T extends { publicId: string; name: string; colourCode: string | null },
>(
  cardLabels: { label: T & { boardId: number } }[],
  boardId: number,
): Omit<T, "boardId">[] =>
  cardLabels.flatMap(({ label: { boardId: labelBoardId, ...label } }) =>
    labelBoardId === boardId ? [label] : [],
  );

/**
 * Card columns and relations loaded for a board view. Shared cards are loaded
 * with the same shape as the board's own cards, so both can be formatted alike.
 */
const boardCardQuery = (includeCardDetails: boolean) =>
  ({
    columns: {
      id: true,
      publicId: true,
      title: true,
      description: includeCardDetails,
      listId: true,
      index: true,
      dueDate: true,
      completed: true,
      cardNumber: true,
      coverColourCode: true,
      coverSize: true,
      externalUrl: true,
    },
    with: {
      coverAttachment: {
        columns: {
          publicId: true,
        },
      },
      labels: {
        with: {
          label: {
            columns: {
              publicId: true,
              name: true,
              colourCode: true,
              boardId: true,
            },
          },
        },
      },
      members: {
        with: {
          member: {
            columns: {
              publicId: true,
              email: true,
              deletedAt: true,
            },
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      },
      // In the compact summary view the detail relations are kept in the
      // query shape (stable types) but return no rows.
      attachments: {
        columns: {
          publicId: true,
        },
        where: includeCardDetails
          ? isNull(cardAttachments.deletedAt)
          : sql`false`,
        orderBy: asc(cardAttachments.createdAt),
      },
      checklists: {
        columns: {
          publicId: true,
          name: true,
          index: true,
        },
        where: includeCardDetails ? isNull(checklists.deletedAt) : sql`false`,
        orderBy: asc(checklists.index),
        with: {
          items: {
            columns: {
              publicId: true,
              title: true,
              completed: true,
              index: true,
            },
            where: isNull(checklistItems.deletedAt),
            orderBy: asc(checklistItems.index),
          },
        },
      },
      comments: {
        columns: {
          publicId: true,
        },
        where: includeCardDetails ? isNull(comments.deletedAt) : sql`false`,
        limit: 1,
      },
    },
  }) as const;

export const getByPublicId = async (
  db: dbClient,
  boardPublicId: string,
  userId: string,
  filters: {
    members: string[];
    labels: string[];
    lists: string[];
    dueDate: DueDateFilter[];
    completed?: boolean;
    type: "regular" | "template" | undefined;
    cardView?: "full" | "summary";
  },
) => {
  const includeCardDetails = filters.cardView !== "summary";
  let cardIds: string[] = [];

  if (filters.labels.length > 0 || filters.members.length > 0) {
    const filteredCards = await db
      .select({
        publicId: cards.publicId,
      })
      .from(cards)
      .leftJoin(cardsToLabels, eq(cards.id, cardsToLabels.cardId))
      .leftJoin(labels, eq(cardsToLabels.labelId, labels.id))
      .leftJoin(
        cardToWorkspaceMembers,
        eq(cards.id, cardToWorkspaceMembers.cardId),
      )
      .leftJoin(
        workspaceMembers,
        eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
      )
      .where(
        and(
          isNull(cards.deletedAt),
          or(
            filters.labels.length > 0
              ? inArray(labels.publicId, filters.labels)
              : undefined,
            filters.members.length > 0
              ? inArray(workspaceMembers.publicId, filters.members)
              : undefined,
          ),
        ),
      );

    cardIds = filteredCards.map((card) => card.publicId);
  }

  const board = await db.query.boards.findFirst({
    columns: {
      id: true,
      type: true,
      publicId: true,
      name: true,
      slug: true,
      visibility: true,
      isArchived: true,
      backgroundColourCode: true,
      backgroundImageKey: true,
      backgroundImageUrl: true,
    },
    with: {
      userFavorites: {
        where: eq(userBoardFavorites.userId, userId),
        columns: {
          userId: true,
        },
      },
      workspace: {
        columns: {
          publicId: true,
          cardPrefix: true,
        },
        with: {
          members: {
            columns: {
              id: true,
              publicId: true,
              email: true,
              status: true,
              role: true,
            },
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
            where: isNull(workspaceMembers.deletedAt),
          },
        },
      },
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
        where: isNull(labels.deletedAt),
      },
      lists: {
        columns: {
          id: true,
          publicId: true,
          name: true,
          boardId: true,
          index: true,
        },
        with: {
          cards: {
            ...boardCardQuery(includeCardDetails),
            where: and(
              cardIds.length > 0 ? inArray(cards.publicId, cardIds) : undefined,
              isNull(cards.deletedAt),
              buildDueDateWhere(filters.dueDate),
              filters.completed === undefined
                ? undefined
                : eq(cards.completed, filters.completed),
            ),
            orderBy: [asc(cards.index)],
          },
        },
        where: and(
          isNull(lists.deletedAt),
          filters.lists.length > 0
            ? inArray(lists.publicId, filters.lists)
            : undefined,
        ),
        orderBy: [asc(lists.index)],
      },
      allLists: {
        columns: {
          publicId: true,
          name: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [asc(lists.index)],
      },
    },
    where: and(
      eq(boards.publicId, boardPublicId),
      isNull(boards.deletedAt),
      eq(boards.type, filters.type ?? "regular"),
    ),
  });

  if (!board) return null;

  const { id: boardId, type: boardType, ...boardFields } = board;

  const sharedLinks =
    boardType === "regular"
      ? await cardBoardLinkRepo.getSharedCardsByBoardId(db, boardId)
      : [];

  const sharedCards = sharedLinks.length
    ? await db.query.cards.findMany({
        ...boardCardQuery(includeCardDetails),
        where: and(
          inArray(
            cards.id,
            sharedLinks.map((link) => link.cardId),
          ),
          cardIds.length > 0 ? inArray(cards.publicId, cardIds) : undefined,
          isNull(cards.deletedAt),
          buildDueDateWhere(filters.dueDate),
          filters.completed === undefined
            ? undefined
            : eq(cards.completed, filters.completed),
        ),
      })
    : [];

  const sharedCardsById = new Map(sharedCards.map((card) => [card.id, card]));

  const summaryByCardId = new Map<
    number,
    {
      hasDescription: boolean;
      attachmentCount: number;
      hasComments: boolean;
      checklistItemCount: number;
      completedChecklistItemCount: number;
    }
  >();

  if (!includeCardDetails) {
    const ids = [
      ...board.lists.flatMap((list) => list.cards.map((card) => card.id)),
      ...sharedCards.map((card) => card.id),
    ];
    if (ids.length > 0) {
      const [descriptions, attachments, cardComments, items, completedItems] =
        await Promise.all([
          db
            .select({ id: cards.id })
            .from(cards)
            .where(and(inArray(cards.id, ids), isNotNull(cards.description))),
          db
            .select({ cardId: cardAttachments.cardId, count: count() })
            .from(cardAttachments)
            .where(
              and(
                inArray(cardAttachments.cardId, ids),
                isNull(cardAttachments.deletedAt),
              ),
            )
            .groupBy(cardAttachments.cardId),
          db
            .select({ cardId: comments.cardId, count: count() })
            .from(comments)
            .where(
              and(inArray(comments.cardId, ids), isNull(comments.deletedAt)),
            )
            .groupBy(comments.cardId),
          db
            .select({ cardId: checklists.cardId, count: count() })
            .from(checklistItems)
            .innerJoin(
              checklists,
              eq(checklistItems.checklistId, checklists.id),
            )
            .where(
              and(
                inArray(checklists.cardId, ids),
                isNull(checklists.deletedAt),
                isNull(checklistItems.deletedAt),
              ),
            )
            .groupBy(checklists.cardId),
          db
            .select({ cardId: checklists.cardId, count: count() })
            .from(checklistItems)
            .innerJoin(
              checklists,
              eq(checklistItems.checklistId, checklists.id),
            )
            .where(
              and(
                inArray(checklists.cardId, ids),
                isNull(checklists.deletedAt),
                isNull(checklistItems.deletedAt),
                eq(checklistItems.completed, true),
              ),
            )
            .groupBy(checklists.cardId),
        ]);

      const attachmentCounts = new Map(
        attachments.map(({ cardId, count }) => [cardId, count]),
      );
      const commentCounts = new Map(
        cardComments.map(({ cardId, count }) => [cardId, count]),
      );
      const itemCounts = new Map(
        items.map(({ cardId, count }) => [cardId, count]),
      );
      const completedItemCounts = new Map(
        completedItems.map(({ cardId, count }) => [cardId, count]),
      );

      const cardsWithDescription = new Set(descriptions.map(({ id }) => id));
      for (const id of ids) {
        summaryByCardId.set(id, {
          hasDescription: cardsWithDescription.has(id),
          attachmentCount: attachmentCounts.get(id) ?? 0,
          hasComments: (commentCounts.get(id) ?? 0) > 0,
          checklistItemCount: itemCounts.get(id) ?? 0,
          completedChecklistItemCount: completedItemCounts.get(id) ?? 0,
        });
      }
    }
  }

  const formatCard = (card: (typeof sharedCards)[number]) => {
    const { id: _id, ...cardWithoutId } = card;
    return {
      ...cardWithoutId,
      ...(filters.cardView === "summary" && {
        summary: summaryByCardId.get(card.id),
      }),
      description: includeCardDetails
        ? ((card as { description?: string | null }).description ?? null)
        : null,
      attachments: includeCardDetails ? card.attachments : [],
      checklists: includeCardDetails
        ? card.checklists.map((checklist) => ({
            ...checklist,
            items: "items" in checklist ? checklist.items : [],
          }))
        : [],
      comments: includeCardDetails ? card.comments : [],
      // Shared cards show this board's labels; their home labels come
      // separately in homeLabels.
      labels: labelsOfBoard(card.labels, boardId),
      members: card.members
        .map((member) => member.member)
        .filter((member) => member.deletedAt === null),
    };
  };

  const formattedResult = {
    ...boardFields,
    favorite: board.userFavorites.length > 0,
    userFavorites: undefined,
    lists: board.lists.map(({ id: listId, ...list }) => {
      const shared = sharedLinks.flatMap((link) => {
        const card =
          link.listId === listId ? sharedCardsById.get(link.cardId) : undefined;

        return card
          ? [
              {
                ...formatCard(card),
                index: link.index,
                sharedFrom: {
                  publicId: link.homeBoardPublicId,
                  name: link.homeBoardName,
                },
                homeLabels: labelsOfBoard(card.labels, link.homeBoardId),
              },
            ]
          : [];
      });

      return {
        ...list,
        cards: mergeListOrder(
          list.cards.map((card) => ({
            ...formatCard(card),
            sharedFrom: null,
            homeLabels: [],
          })),
          shared,
        ).map((card, position) => ({
          ...card,
          index: shared.length ? position : card.index,
        })),
      };
    }),
  };

  return formattedResult;
};

export const getBySlug = async (
  db: dbClient,
  boardSlug: string,
  workspaceId: number,
  filters: {
    members: string[];
    labels: string[];
    lists: string[];
    dueDate: DueDateFilter[];
    completed?: boolean;
  },
) => {
  let cardIds: string[] = [];

  if (filters.labels.length) {
    const filteredCards = await db
      .select({
        publicId: cards.publicId,
      })
      .from(cards)
      .leftJoin(cardsToLabels, eq(cards.id, cardsToLabels.cardId))
      .leftJoin(labels, eq(cardsToLabels.labelId, labels.id))
      .where(
        and(
          isNull(cards.deletedAt),
          filters.labels.length > 0
            ? inArray(labels.publicId, filters.labels)
            : undefined,
        ),
      );

    cardIds = filteredCards.map((card) => card.publicId);
  }

  const board = await db.query.boards.findFirst({
    columns: {
      publicId: true,
      name: true,
      slug: true,
      visibility: true,
      backgroundColourCode: true,
      backgroundImageKey: true,
      backgroundImageUrl: true,
    },
    with: {
      workspace: {
        columns: {
          publicId: true,
          name: true,
          slug: true,
          cardPrefix: true,
        },
      },
      labels: {
        columns: {
          publicId: true,
          name: true,
          colourCode: true,
        },
        where: isNull(labels.deletedAt),
      },
      lists: {
        columns: {
          publicId: true,
          name: true,
          boardId: true,
          index: true,
        },
        with: {
          cards: {
            columns: {
              publicId: true,
              title: true,
              description: true,
              listId: true,
              index: true,
              dueDate: true,
              completed: true,
              cardNumber: true,
              coverColourCode: true,
              coverSize: true,
            },
            with: {
              coverAttachment: {
                columns: {
                  publicId: true,
                },
              },
              labels: {
                with: {
                  label: {
                    columns: {
                      publicId: true,
                      name: true,
                      colourCode: true,
                      boardId: true,
                    },
                  },
                },
              },
              attachments: {
                columns: {
                  publicId: true,
                },
                where: isNull(cardAttachments.deletedAt),
                orderBy: asc(cardAttachments.createdAt),
              },
              comments: {
                columns: {
                  publicId: true,
                },
                where: isNull(comments.deletedAt),
                limit: 1,
              },
              checklists: {
                columns: {
                  publicId: true,
                  name: true,
                  index: true,
                },
                where: isNull(checklists.deletedAt),
                orderBy: asc(checklists.index),
                with: {
                  items: {
                    columns: {
                      publicId: true,
                      title: true,
                      completed: true,
                      index: true,
                    },
                    where: isNull(checklistItems.deletedAt),
                    orderBy: asc(checklistItems.index),
                  },
                },
              },
            },
            where: and(
              cardIds.length > 0 ? inArray(cards.publicId, cardIds) : undefined,
              isNull(cards.deletedAt),
              buildDueDateWhere(filters.dueDate),
              filters.completed === undefined
                ? undefined
                : eq(cards.completed, filters.completed),
            ),
            orderBy: [asc(cards.index)],
          },
        },
        where: and(
          isNull(lists.deletedAt),
          filters.lists.length > 0
            ? inArray(lists.publicId, filters.lists)
            : undefined,
        ),
        orderBy: [asc(lists.index)],
      },
      allLists: {
        columns: {
          publicId: true,
          name: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [asc(lists.index)],
      },
    },
    where: and(
      eq(boards.slug, boardSlug),
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
      eq(boards.visibility, "public"),
    ),
  });

  if (!board) return null;

  const formattedResult = {
    ...board,
    lists: board.lists.map((list) => ({
      ...list,
      cards: list.cards.map((card) => ({
        ...card,
        labels: labelsOfBoard(card.labels, list.boardId),
      })),
    })),
  };

  return formattedResult;
};

export const getWithListIdsByPublicId = (
  db: dbClient,
  boardPublicId: string,
) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
      createdBy: true,
      type: true,
    },
    with: {
      lists: {
        columns: {
          id: true,
        },
      },
    },
    where: eq(boards.publicId, boardPublicId),
  });
};

export const getWithLatestListIndexByPublicId = (
  db: dbClient,
  boardPublicId: string,
) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
    },
    with: {
      lists: {
        columns: {
          index: true,
        },
        where: isNull(lists.deletedAt),
        orderBy: [desc(lists.index)],
        limit: 1,
      },
    },
    where: eq(boards.publicId, boardPublicId),
  });
};

export const create = async (
  db: dbClient,
  boardInput: {
    publicId?: string;
    name: string;
    createdBy: string;
    workspaceId: number;
    importId?: number;
    slug: string;
    type?: "regular" | "template";
    sourceBoardId?: number;
    background?:
      | { kind: "colour"; colourCode: string }
      | { kind: "image"; imageKey: string }
      | { kind: "url"; url: string }
      | null;
  },
) => {
  return db.transaction(async (tx) => {
    const type = boardInput.type ?? "regular";

    const [result] = await tx
      .insert(boards)
      .values({
        publicId: boardInput.publicId ?? generateUID(),
        name: boardInput.name,
        createdBy: boardInput.createdBy,
        workspaceId: boardInput.workspaceId,
        importId: boardInput.importId,
        slug: boardInput.slug,
        type,
        sourceBoardId: boardInput.sourceBoardId,
        backgroundColourCode:
          boardInput.background?.kind === "colour"
            ? boardInput.background.colourCode
            : null,
        backgroundImageKey:
          boardInput.background?.kind === "image"
            ? boardInput.background.imageKey
            : null,
        backgroundImageUrl:
          boardInput.background?.kind === "url"
            ? boardInput.background.url
            : null,
      })
      .returning({
        id: boards.id,
        publicId: boards.publicId,
        name: boards.name,
      });

    if (result && type === "regular") {
      await boardMemberRepo.addCreatorAsAdmin(tx, {
        boardId: result.id,
        workspaceId: boardInput.workspaceId,
        userId: boardInput.createdBy,
      });
    }

    return result;
  });
};

export const update = async (
  db: dbClient,
  boardInput: {
    name: string | undefined;
    slug: string | undefined;
    visibility: BoardVisibilityStatus | undefined;
    boardPublicId: string;
    isArchived?: boolean;
    background?:
      | { kind: "colour"; colourCode: string }
      | { kind: "image"; imageKey: string }
      | { kind: "url"; url: string }
      | null;
  },
) => {
  const [result] = await db
    .update(boards)
    .set({
      name: boardInput.name,
      slug: boardInput.slug,
      visibility: boardInput.visibility,
      updatedAt: new Date(),
      ...(boardInput.isArchived !== undefined && {
        isArchived: boardInput.isArchived,
      }),
      ...(boardInput.background !== undefined && {
        backgroundColourCode:
          boardInput.background?.kind === "colour"
            ? boardInput.background.colourCode
            : null,
        backgroundImageKey:
          boardInput.background?.kind === "image"
            ? boardInput.background.imageKey
            : null,
        backgroundImageUrl:
          boardInput.background?.kind === "url"
            ? boardInput.background.url
            : null,
      }),
    })
    .where(eq(boards.publicId, boardInput.boardPublicId))
    .returning({
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const softDelete = async (
  db: dbClient,
  args: {
    boardId: number;
    deletedAt: Date;
    deletedBy: string;
  },
) => {
  const [result] = await db
    .update(boards)
    .set({ deletedAt: args.deletedAt, deletedBy: args.deletedBy })
    .where(and(eq(boards.id, args.boardId), isNull(boards.deletedAt)))
    .returning({
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const hardDelete = async (db: dbClient, workspaceId: number) => {
  const [result] = await db
    .delete(boards)
    .where(eq(boards.workspaceId, workspaceId))
    .returning({
      publicId: boards.publicId,
      name: boards.name,
    });

  return result;
};

export const isSlugUnique = async (
  db: dbClient,
  args: { slug: string; workspaceId: number },
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      slug: true,
    },
    where: and(
      eq(boards.slug, args.slug),
      eq(boards.workspaceId, args.workspaceId),
      isNull(boards.deletedAt),
    ),
  });

  return result === undefined;
};

export const getWorkspaceAndBoardIdByBoardPublicId = async (
  db: dbClient,
  boardPublicId: string,
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      id: true,
      workspaceId: true,
      createdBy: true,
      type: true,
      visibility: true,
      deletedAt: true,
      backgroundImageKey: true,
    },
    where: eq(boards.publicId, boardPublicId),
  });

  return result;
};

export const getBackgroundsByPublicIds = async (
  db: dbClient,
  boardPublicIds: string[],
) => {
  if (boardPublicIds.length === 0) return [];

  return db
    .select({
      id: boards.id,
      type: boards.type,
      publicId: boards.publicId,
      workspaceId: boards.workspaceId,
      visibility: boards.visibility,
      backgroundImageKey: boards.backgroundImageKey,
    })
    .from(boards)
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .where(
      and(
        inArray(boards.publicId, boardPublicIds),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    );
};

export const getCoverAccessByPublicId = async (
  db: dbClient,
  boardPublicId: string,
) => {
  const [result] = await db
    .select({
      id: boards.id,
      workspaceId: boards.workspaceId,
      visibility: boards.visibility,
      type: boards.type,
    })
    .from(boards)
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .where(
      and(
        eq(boards.publicId, boardPublicId),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    );

  return result;
};

/**
 * Fetches the board fields needed by the move mutation:
 * identity, naming, type guards, and workspace ownership.
 * Soft-deleted boards are excluded — moving a tombstoned board has
 * no defensible semantics.
 */
export const getBoardForMove = async (db: dbClient, boardPublicId: string) => {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      name: true,
      slug: true,
      type: true,
      isArchived: true,
      workspaceId: true,
      createdBy: true,
    },
    where: and(eq(boards.publicId, boardPublicId), isNull(boards.deletedAt)),
  });
};

export const isBoardSlugAvailable = async (
  db: dbClient,
  boardSlug: string,
  workspaceId: number,
) => {
  const result = await db.query.boards.findFirst({
    columns: {
      id: true,
    },
    where: and(
      eq(boards.slug, boardSlug),
      eq(boards.workspaceId, workspaceId),
      isNull(boards.deletedAt),
    ),
  });

  return result === undefined;
};

// Create a new board (regular/template) from a full board snapshot
export const createFromSnapshot = async (
  db: dbClient,
  args: {
    source: {
      name: string;
      labels: { publicId: string; name: string; colourCode: string | null }[];
      lists: {
        name: string;
        index: number;
        cards: {
          title: string;
          description: string | null;
          index: number;
          coverColourCode: string | null;
          coverSize: "normal" | "full";
          labels: {
            publicId: string;
            name: string;
            colourCode: string | null;
          }[];
          checklists?: {
            publicId: string;
            name: string;
            index: number;
            items: {
              publicId: string;
              title: string;
              completed: boolean;
              index: number;
            }[];
          }[];
        }[];
      }[];
    };
    workspaceId: number;
    createdBy: string;
    publicId?: string;
    backgroundColourCode?: string | null;
    backgroundImageKey?: string | null;
    backgroundImageUrl?: string | null;
    slug: string;
    name?: string;
    type: "regular" | "template";
    sourceBoardId?: number;
  },
) => {
  return db.transaction(async (tx) => {
    const [newBoard] = await tx
      .insert(boards)
      .values({
        publicId: args.publicId ?? generateUID(),
        name: args.name ?? args.source.name,
        slug: args.slug,
        createdBy: args.createdBy,
        workspaceId: args.workspaceId,
        type: args.type,
        sourceBoardId: args.sourceBoardId,
        backgroundColourCode: args.backgroundColourCode,
        backgroundImageKey: args.backgroundImageKey,
        backgroundImageUrl: args.backgroundImageUrl,
      })
      .returning({
        id: boards.id,
        publicId: boards.publicId,
        name: boards.name,
      });

    if (!newBoard) throw new Error("Failed to create board");

    if (args.type === "regular") {
      await boardMemberRepo.addCreatorAsAdmin(tx, {
        boardId: newBoard.id,
        workspaceId: args.workspaceId,
        userId: args.createdBy,
      });
    }

    // Labels
    const srcLabels = args.source.labels;
    const labelMap = new Map<string, number>();

    if (srcLabels.length) {
      const inserted = await tx
        .insert(labels)
        .values(
          srcLabels.map((l) => ({
            publicId: generateUID(),
            name: l.name,
            colourCode: l.colourCode ?? null,
            createdBy: args.createdBy,
            boardId: newBoard.id,
          })),
        )
        .returning({ id: labels.id });

      for (let i = 0; i < srcLabels.length; i++) {
        const src = srcLabels[i];

        if (!src) throw new Error("Source label not found");

        const created = inserted[i];
        if (created) labelMap.set(src.publicId, created.id);
      }
    }

    // Lists
    const listIndexToId = new Map<number, number>();
    const srcLists = [...args.source.lists].sort((a, b) => a.index - b.index);
    if (srcLists.length) {
      const insertedLists = await tx
        .insert(lists)
        .values(
          srcLists.map((list) => ({
            publicId: generateUID(),
            name: list.name,
            createdBy: args.createdBy,
            boardId: newBoard.id,
            index: list.index,
          })),
        )
        .returning({ id: lists.id, index: lists.index });

      for (const list of insertedLists) listIndexToId.set(list.index, list.id);
    }

    // Cards, card-labels, checklists
    for (const list of srcLists) {
      const newListId = listIndexToId.get(list.index);
      if (!newListId) continue;
      const sortedCards = [...list.cards].sort((a, b) => a.index - b.index);

      for (const card of sortedCards) {
        const [createdCard] = await tx
          .insert(cards)
          .values({
            publicId: generateUID(),
            title: card.title,
            description: normalizeDescription(card.description),
            createdBy: args.createdBy,
            listId: newListId,
            index: card.index,
            coverColourCode: card.coverColourCode,
            coverSize: card.coverColourCode ? card.coverSize : "normal",
          })
          .returning({ id: cards.id });

        if (!createdCard) throw new Error("Failed to create card");

        // Create card.created activity
        await tx.insert(cardActivities).values({
          publicId: generateUID(),
          type: "card.created",
          cardId: createdCard.id,
          createdBy: args.createdBy,
          sourceBoardId: args.sourceBoardId,
        });

        if (card.labels.length) {
          const cardLabels: { cardId: number; labelId: number }[] = [];
          for (const label of card.labels) {
            const newLabelId = labelMap.get(label.publicId);
            if (newLabelId)
              cardLabels.push({ cardId: createdCard.id, labelId: newLabelId });
          }
          if (cardLabels.length) {
            await tx.insert(cardsToLabels).values(cardLabels);

            // Create card.updated.label.added activities for each label
            const labelActivities = cardLabels.map((cardLabel) => ({
              publicId: generateUID(),
              type: "card.updated.label.added" as const,
              cardId: cardLabel.cardId,
              labelId: cardLabel.labelId,
              createdBy: args.createdBy,
              sourceBoardId: args.sourceBoardId,
            }));
            await tx.insert(cardActivities).values(labelActivities);
          }
        }

        if (card.checklists?.length) {
          const sortedChecklists = [...card.checklists].sort(
            (a, b) => a.index - b.index,
          );
          for (const checklist of sortedChecklists) {
            const [createdChecklist] = await tx
              .insert(checklists)
              .values({
                publicId: generateUID(),
                name: checklist.name,
                createdBy: args.createdBy,
                cardId: createdCard.id,
                index: checklist.index,
              })
              .returning({ id: checklists.id });

            if (!createdChecklist) continue;

            // Create card.updated.checklist.added activity
            await tx.insert(cardActivities).values({
              publicId: generateUID(),
              type: "card.updated.checklist.added",
              cardId: createdCard.id,
              toTitle: checklist.name,
              createdBy: args.createdBy,
              sourceBoardId: args.sourceBoardId,
            });

            if (checklist.items.length) {
              const itemValues = [...checklist.items]
                .sort((a, b) => a.index - b.index)
                .map((checklistItem) => ({
                  publicId: generateUID(),
                  title: checklistItem.title,
                  createdBy: args.createdBy,
                  checklistId: createdChecklist.id,
                  index: checklistItem.index,
                  completed: !!checklistItem.completed,
                }));

              if (itemValues.length) {
                await tx.insert(checklistItems).values(itemValues);

                // Create card.updated.checklist.item.added activities for each item
                const itemActivities = itemValues.map((item) => ({
                  publicId: generateUID(),
                  type: "card.updated.checklist.item.added" as const,
                  cardId: createdCard.id,
                  toTitle: item.title,
                  createdBy: args.createdBy,
                  sourceBoardId: args.sourceBoardId,
                }));
                await tx.insert(cardActivities).values(itemActivities);
              }
            }
          }
        }
      }
    }

    return newBoard;
  });
};

export const moveToWorkspace = async (
  db: dbClient,
  boardId: number,
  targetWorkspaceId: number,
  movedBy: string,
  newSlug?: string,
) => {
  return db.transaction(async (tx) => {
    // Update the board's workspace (and slug if provided)
    const [updatedBoard] = await tx
      .update(boards)
      .set({
        workspaceId: targetWorkspaceId,
        ...(newSlug && { slug: newSlug }),
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId))
      .returning({
        publicId: boards.publicId,
        name: boards.name,
      });

    if (!updatedBoard) throw new Error("Failed to move board");

    // Get every card ID ever belonging to this board, including
    // soft-deleted cards under soft-deleted lists. Member assignments
    // point at workspace-scoped members that no longer exist after
    // the move; if we leave assignments on soft-deleted cards, a later
    // restore would resurrect rogue references to the old workspace.
    const boardLists = await tx
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.boardId, boardId));

    if (boardLists.length > 0) {
      const listIds = boardLists.map((l) => l.id);

      const boardCards = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(inArray(cards.listId, listIds));

      if (boardCards.length > 0) {
        const cardIds = boardCards.map((c) => c.id);

        // Clear all card member assignments (they reference workspace-scoped members)
        await tx
          .delete(cardToWorkspaceMembers)
          .where(inArray(cardToWorkspaceMembers.cardId, cardIds));
      }
    }

    // Board memberships reference members of the old workspace. Carry them
    // over (same role) for people who are also in the target workspace; the
    // mover is re-added as admin below. Everyone else loses access.
    await tx.execute(sql`
      INSERT INTO "board_members" ("boardId", "workspaceMemberId", "role", "createdBy", "createdAt")
      SELECT bm."boardId", target."id", bm."role", bm."createdBy", now()
      FROM "board_members" bm
      INNER JOIN "workspace_members" source ON source."id" = bm."workspaceMemberId"
      INNER JOIN "workspace_members" target ON target."userId" = source."userId"
        AND target."workspaceId" = ${targetWorkspaceId}
        AND target."deletedAt" IS NULL
        AND target."status" <> 'removed'
      WHERE bm."boardId" = ${boardId}
        AND source."userId" <> ${movedBy}
      ON CONFLICT DO NOTHING
    `);

    await tx
      .delete(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId, boardId),
          notInArray(
            boardMembers.workspaceMemberId,
            tx
              .select({ id: workspaceMembers.id })
              .from(workspaceMembers)
              .where(eq(workspaceMembers.workspaceId, targetWorkspaceId)),
          ),
        ),
      );

    await boardMemberRepo.addCreatorAsAdmin(tx, {
      boardId,
      workspaceId: targetWorkspaceId,
      userId: movedBy,
    });

    return updatedBoard;
  });
};

export const addUserFavorite = async (
  db: dbClient,
  userId: string,
  boardId: number,
) => {
  return db
    .insert(userBoardFavorites)
    .values({
      userId,
      boardId,
    })
    .onConflictDoNothing()
    .returning();
};

export const removeUserFavorite = async (
  db: dbClient,
  userId: string,
  boardId: number,
) => {
  return db
    .delete(userBoardFavorites)
    .where(
      and(
        eq(userBoardFavorites.userId, userId),
        eq(userBoardFavorites.boardId, boardId),
      ),
    )
    .returning();
};

export const getDiscordRoleIds = async (db: dbClient, boardId: number) => {
  const [result] = await db
    .select({ discordRoleIds: boards.discordRoleIds })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);

  return result?.discordRoleIds ?? null;
};

export const updateDiscordRoleIds = async (
  db: dbClient,
  args: { boardId: number; discordRoleIds: string[] | null },
) => {
  const [result] = await db
    .update(boards)
    .set({ discordRoleIds: args.discordRoleIds, updatedAt: new Date() })
    .where(eq(boards.id, args.boardId))
    .returning({ publicId: boards.publicId, name: boards.name });

  return result;
};
