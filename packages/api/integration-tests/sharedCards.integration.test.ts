import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as boardMemberRepo from "@kan/db/repository/boardMember.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardBoardLinkRepo from "@kan/db/repository/cardBoardLink.repo";
import * as schema from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { cardRouter } from "../src/routers/card";
import { filterCardAssignable, hasCardAccess } from "../src/utils/permissions";
import { createTestDb, seedTestData } from "./test-db";

vi.mock("@kan/auth/server", () => ({
  initAuth: vi.fn(() => ({ api: {} })),
}));
vi.mock("../src/utils/notifications", () => ({
  sendMentionEmails: vi.fn(),
}));
vi.mock("../src/utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(() => ({})),
  sendWebhooksForWorkspace: vi.fn(() => Promise.resolve()),
}));

describe("shared cards", () => {
  let db: TestDbClient;
  let owner: { id: string; name: string | null; email: string };
  let workspace: { id: number; publicId: string };

  let homeBoard: { id: number; publicId: string };
  let sharedBoard: { id: number; publicId: string };
  let otherBoard: { id: number; publicId: string };
  let homeList: { id: number; publicId: string };
  let sharedTodo: { id: number; publicId: string };
  let sharedDone: { id: number; publicId: string };

  let sharedMember: { id: string; name: string | null; email: string };
  let sharedMemberWm: { id: number; publicId: string; role: string };
  let outsider: { id: string; name: string | null; email: string };

  const makeBoard = async (publicId: string, name: string) => {
    const [board] = await db
      .insert(schema.boards)
      .values({
        publicId,
        name,
        slug: publicId,
        workspaceId: workspace.id,
        createdBy: owner.id,
      })
      .returning();
    return board!;
  };

  const makeList = async (publicId: string, boardId: number, index: number) => {
    const [list] = await db
      .insert(schema.lists)
      .values({
        publicId,
        name: publicId,
        index,
        boardId,
        createdBy: owner.id,
      })
      .returning();
    return list!;
  };

  const makeCard = async (title: string, listId: number) =>
    cardRepo.create(db, {
      title,
      description: "",
      createdBy: owner.id,
      listId,
      workspaceId: workspace.id,
      position: "end",
      dueDate: null,
    });

  const addMember = async (publicId: string, boardIds: number[]) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name: publicId,
        email: `${publicId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const [member] = await db
      .insert(schema.workspaceMembers)
      .values({
        publicId,
        email: user!.email,
        workspaceId: workspace.id,
        userId: user!.id,
        createdBy: owner.id,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      .returning();
    for (const boardId of boardIds)
      await boardMemberRepo.add(db, {
        boardId,
        workspaceMemberId: member!.id,
        role: "member",
        createdBy: owner.id,
      });
    return { user: user!, member: member! };
  };

  const caller = (user: { id: string; name: string | null; email: string }) =>
    cardRouter.createCaller({
      db,
      user: {
        ...user,
        name: user.name ?? "",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      headers: new Headers(),
    } as never);

  const target = (cardId: number) => ({
    id: cardId,
    boardId: homeBoard.id,
    workspaceId: workspace.id,
    boardType: "regular",
  });

  const sharedBoardView = async () => {
    const board = await boardRepo.getByPublicId(
      db,
      sharedBoard.publicId,
      owner.id,
      { members: [], labels: [], lists: [], dueDate: [], type: "regular" },
    );
    return board!.lists.map((list) => ({
      list: list.publicId,
      cards: list.cards.map((card) => [
        card.title,
        card.index,
        card.sharedFrom?.name ?? null,
      ]),
    }));
  };

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    owner = seeded.user;
    workspace = seeded.workspace;

    homeBoard = await makeBoard("bdhome123456", "Dev");
    sharedBoard = await makeBoard("bdshared1234", "Exchanges");
    otherBoard = await makeBoard("bdother12345", "Mapping");
    homeList = await makeList("lthome123456", homeBoard.id, 0);
    sharedTodo = await makeList("ltsharedtodo", sharedBoard.id, 0);
    sharedDone = await makeList("ltshareddone", sharedBoard.id, 1);

    const shared = await addMember("wmshared1234", [sharedBoard.id]);
    sharedMember = shared.user;
    sharedMemberWm = shared.member;
    outsider = (await addMember("wmoutsider12", [otherBoard.id])).user;
  });

  it("grants access through a shared board and revokes it on removal", async () => {
    const card = await makeCard("Blocked: question", homeList.id);

    expect(await hasCardAccess(db, sharedMember.id, target(card.id))).toBe(
      false,
    );

    await cardBoardLinkRepo.create(db, {
      cardId: card.id,
      boardId: sharedBoard.id,
      listId: sharedTodo.id,
      createdBy: owner.id,
    });

    expect(await hasCardAccess(db, sharedMember.id, target(card.id))).toBe(
      true,
    );
    expect(await hasCardAccess(db, outsider.id, target(card.id))).toBe(false);

    await cardBoardLinkRepo.remove(db, {
      cardId: card.id,
      boardId: sharedBoard.id,
    });

    expect(await hasCardAccess(db, sharedMember.id, target(card.id))).toBe(
      false,
    );
  });

  it("stops granting access when the shared list or board is deleted", async () => {
    const card = await makeCard("Card", homeList.id);
    await cardBoardLinkRepo.create(db, {
      cardId: card.id,
      boardId: sharedBoard.id,
      listId: sharedTodo.id,
      createdBy: owner.id,
    });

    await db
      .update(schema.lists)
      .set({ deletedAt: new Date() })
      .where(eq(schema.lists.id, sharedTodo.id));

    expect(await hasCardAccess(db, sharedMember.id, target(card.id))).toBe(
      false,
    );
  });

  it("removes the link when the card is hard deleted", async () => {
    const card = await makeCard("Card", homeList.id);
    await cardBoardLinkRepo.create(db, {
      cardId: card.id,
      boardId: sharedBoard.id,
      listId: sharedTodo.id,
      createdBy: owner.id,
    });

    await db.delete(schema.cards).where(eq(schema.cards.id, card.id));

    expect(await db.select().from(schema.cardBoardLinks)).toEqual([]);
  });

  it("offers members of every board the card is on as assignees", async () => {
    const card = await makeCard("Card", homeList.id);
    const candidates = [{ id: sharedMemberWm.id, role: "member" }];

    expect(await filterCardAssignable(db, target(card.id), candidates)).toEqual(
      [],
    );

    await cardBoardLinkRepo.create(db, {
      cardId: card.id,
      boardId: sharedBoard.id,
      listId: sharedTodo.id,
      createdBy: owner.id,
    });

    expect(await filterCardAssignable(db, target(card.id), candidates)).toEqual(
      candidates,
    );
  });

  it("shows shared cards on the board at their position, with their origin", async () => {
    await makeCard("Own A", sharedTodo.id);
    const ownB = await makeCard("Own B", sharedTodo.id);
    const card = await makeCard("From dev", homeList.id);

    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    expect(await sharedBoardView()).toEqual([
      {
        list: sharedTodo.publicId,
        cards: [
          ["Own A", 0, null],
          ["Own B", 1, null],
          ["From dev", 2, "Dev"],
        ],
      },
      { list: sharedDone.publicId, cards: [] },
    ]);

    await caller(sharedMember).update({
      cardPublicId: card.publicId,
      listPublicId: sharedTodo.publicId,
      index: 0,
    });

    expect((await sharedBoardView())[0]!.cards).toEqual([
      ["From dev", 0, "Dev"],
      ["Own A", 1, null],
      ["Own B", 2, null],
    ]);

    await caller(owner).update({
      cardPublicId: ownB.publicId,
      listPublicId: sharedTodo.publicId,
      index: 0,
    });

    expect((await sharedBoardView())[0]!.cards).toEqual([
      ["Own B", 0, null],
      ["From dev", 1, "Dev"],
      ["Own A", 2, null],
    ]);

    await caller(owner).delete({ cardPublicId: card.publicId });

    expect((await sharedBoardView())[0]!.cards).toEqual([
      ["Own B", 0, null],
      ["Own A", 1, null],
    ]);
  });

  it("includes shared cards in the compact summary board view", async () => {
    await makeCard("Own A", sharedTodo.id);
    const card = await makeCard("From dev", homeList.id);
    await caller(owner).addComment({
      cardPublicId: card.publicId,
      comment: "Hi",
    });
    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    const board = await boardRepo.getByPublicId(
      db,
      sharedBoard.publicId,
      owner.id,
      {
        members: [],
        labels: [],
        lists: [],
        dueDate: [],
        type: "regular",
        cardView: "summary",
      },
    );
    const cards = board!.lists[0]!.cards;

    expect(cards.map((c) => [c.title, c.index, c.sharedFrom?.name])).toEqual([
      ["Own A", 0, undefined],
      ["From dev", 1, "Dev"],
    ]);
    expect(cards[1]).toMatchObject({
      description: null,
      comments: [],
      summary: { hasComments: true, attachmentCount: 0 },
    });
    expect(cards[0]!.summary).toMatchObject({ hasComments: false });
  });

  it("shows a shared card's completion on every board it is on", async () => {
    const card = await makeCard("From dev", homeList.id);
    await makeCard("Own A", sharedTodo.id);
    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    await caller(sharedMember).update({
      cardPublicId: card.publicId,
      completed: true,
    });

    const view = async (
      boardPublicId: string,
      filters: { completed?: boolean; cardView?: "summary" } = {},
    ) => {
      const board = await boardRepo.getByPublicId(db, boardPublicId, owner.id, {
        members: [],
        labels: [],
        lists: [],
        dueDate: [],
        type: "regular",
        ...filters,
      });
      return board!.lists.flatMap((list) =>
        list.cards.map((item) => [item.title, item.completed]),
      );
    };

    expect(await view(homeBoard.publicId)).toEqual([["From dev", true]]);
    expect(await view(sharedBoard.publicId, { cardView: "summary" })).toEqual([
      ["Own A", false],
      ["From dev", true],
    ]);
    expect(await view(sharedBoard.publicId, { completed: true })).toEqual([
      ["From dev", true],
    ]);
    expect(await view(sharedBoard.publicId, { completed: false })).toEqual([
      ["Own A", false],
    ]);
    expect(
      (await caller(sharedMember).byId({ cardPublicId: card.publicId }))
        .completed,
    ).toBe(true);
  });

  it("resolves cover attachments of cards shared onto a board", async () => {
    const card = await makeCard("From dev", homeList.id);
    const [attachment] = await db
      .insert(schema.cardAttachments)
      .values({
        publicId: "attachcover1",
        cardId: card.id,
        filename: "cover.png",
        originalFilename: "cover.png",
        contentType: "image/png",
        size: 1024,
        s3Key: "workspace/card/cover.png",
        createdBy: owner.id,
      })
      .returning();
    await db
      .update(schema.cards)
      .set({ coverAttachmentId: attachment!.id })
      .where(eq(schema.cards.id, card.id));

    const sharedCovers = () =>
      cardBoardLinkRepo.getSelectedSharedCoverAttachments(db, {
        boardId: sharedBoard.id,
        attachmentPublicIds: ["attachcover1"],
      });

    expect(await sharedCovers()).toEqual([]);

    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    expect(await sharedCovers()).toEqual([{ publicId: "attachcover1" }]);
    expect(
      await cardBoardLinkRepo.getSelectedSharedCoverAttachments(db, {
        boardId: otherBoard.id,
        attachmentPublicIds: ["attachcover1"],
      }),
    ).toEqual([]);
  });

  it("moves only the shared copy's place when moved on the shared board", async () => {
    const card = await makeCard("From dev", homeList.id);
    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    await caller(sharedMember).update({
      cardPublicId: card.publicId,
      listPublicId: sharedDone.publicId,
      index: 0,
    });

    const stored = await cardRepo.getByPublicId(db, card.publicId);
    expect(stored?.listId).toBe(homeList.id);
    expect(
      await cardBoardLinkRepo.getByCardAndBoard(db, {
        cardId: card.id,
        boardId: sharedBoard.id,
      }),
    ).toMatchObject({ listId: sharedDone.id, index: 0 });
  });

  it("lets shared board members edit and comment but not move it home or relabel it", async () => {
    const card = await makeCard("From dev", homeList.id);
    const asShared = caller(sharedMember);

    await expect(
      asShared.byId({ cardPublicId: card.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    const detail = await asShared.byId({ cardPublicId: card.publicId });
    expect(detail.canAccessHomeBoard).toBe(false);
    expect(detail.sharedBoards).toEqual([
      {
        publicId: sharedBoard.publicId,
        name: "Exchanges",
        list: { publicId: sharedTodo.publicId, name: sharedTodo.publicId },
        labels: [],
        externalUrl: null,
      },
    ]);

    await asShared.update({ cardPublicId: card.publicId, title: "Renamed" });
    await asShared.addComment({ cardPublicId: card.publicId, comment: "Hi" });
    await asShared.addOrRemoveMember({
      cardPublicId: card.publicId,
      workspaceMemberPublicId: sharedMemberWm.publicId,
    });

    await expect(
      asShared.update({
        cardPublicId: card.publicId,
        listPublicId: homeList.publicId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asShared.delete({ cardPublicId: card.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [label] = await db
      .insert(schema.labels)
      .values({
        publicId: "lbhome123456",
        name: "Bug",
        boardId: homeBoard.id,
        createdBy: owner.id,
      })
      .returning();
    await expect(
      asShared.addOrRemoveLabel({
        cardPublicId: card.publicId,
        labelPublicId: label!.publicId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller(outsider).byId({ cardPublicId: card.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const activity = await asShared.getActivities({
      cardPublicId: card.publicId,
      limit: 20,
    });
    expect(activity.activities.map((item) => item.type)).toContain(
      "card.updated.board.added",
    );

    await asShared.unshare({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
    });
    await expect(
      asShared.byId({ cardPublicId: card.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a card shared to a board carry that board's labels, shown there only", async () => {
    const makeLabel = async (
      publicId: string,
      name: string,
      boardId: number,
    ) => {
      const [label] = await db
        .insert(schema.labels)
        .values({ publicId, name, boardId, createdBy: owner.id })
        .returning();
      return label!;
    };
    const boardView = async (
      board: { publicId: string },
      labelFilter: string[] = [],
    ) => {
      const view = await boardRepo.getByPublicId(db, board.publicId, owner.id, {
        members: [],
        labels: labelFilter,
        lists: [],
        dueDate: [],
        type: "regular",
      });
      return view!.lists.flatMap((list) =>
        list.cards.map((card) => ({
          title: card.title,
          labels: card.labels.map((label) => label.name),
          homeLabels: card.homeLabels.map((label) => label.name),
        })),
      );
    };
    const cardLabelIds = async (cardId: number) =>
      (
        await db
          .select({ labelId: schema.cardsToLabels.labelId })
          .from(schema.cardsToLabels)
          .where(eq(schema.cardsToLabels.cardId, cardId))
      )
        .map((row) => row.labelId)
        .sort();

    const homeLabel = await makeLabel("lbhome123456", "Bug", homeBoard.id);
    const fromDev = await makeLabel("lbfromdev123", "De Dev", sharedBoard.id);
    const deleted = await makeLabel("lbdeleted123", "Old", sharedBoard.id);
    const otherLabel = await makeLabel("lbother12345", "Map", otherBoard.id);
    await db
      .update(schema.labels)
      .set({ deletedAt: new Date() })
      .where(eq(schema.labels.id, deleted.id));

    const homeMember = (await addMember("wmhome123456", [homeBoard.id])).user;
    const card = await makeCard("From dev", homeList.id);
    await makeCard("Own", sharedTodo.id);
    const toggle = (
      user: { id: string; name: string | null; email: string },
      labelPublicId: string,
    ) =>
      caller(user).addOrRemoveLabel({
        cardPublicId: card.publicId,
        labelPublicId,
      });

    // Before sharing, the board's labels are out of reach.
    await expect(toggle(sharedMember, fromDev.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(toggle(owner, fromDev.publicId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    await toggle(owner, homeLabel.publicId);
    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    // Shared board members label it with their board's labels, and only
    // those; home board members can't touch the shared board's labels.
    await expect(toggle(sharedMember, fromDev.publicId)).resolves.toEqual({
      newLabel: true,
    });
    await expect(toggle(homeMember, fromDev.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      toggle(sharedMember, homeLabel.publicId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(toggle(owner, otherLabel.publicId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(toggle(owner, deleted.publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await cardLabelIds(card.id)).toEqual(
      [homeLabel.id, fromDev.id].sort(),
    );

    // Each board shows its own labels; the shared board keeps the home ones
    // apart, and its label filter finds the card by its labels there.
    expect(await boardView(homeBoard)).toEqual([
      { title: "From dev", labels: ["Bug"], homeLabels: [] },
    ]);
    expect(await boardView(sharedBoard)).toEqual([
      { title: "Own", labels: [], homeLabels: [] },
      { title: "From dev", labels: ["De Dev"], homeLabels: ["Bug"] },
    ]);
    expect(await boardView(sharedBoard, [fromDev.publicId])).toEqual([
      { title: "From dev", labels: ["De Dev"], homeLabels: ["Bug"] },
    ]);

    // The card page tells the boards' labels apart and offers the shared
    // board's labels, to those on that board only.
    const asShared = await caller(sharedMember).byId({
      cardPublicId: card.publicId,
    });
    expect(
      asShared.labels.map((label) => [label.name, label.boardPublicId]),
    ).toEqual(
      expect.arrayContaining([
        ["Bug", homeBoard.publicId],
        ["De Dev", sharedBoard.publicId],
      ]),
    );
    expect(asShared.labels).toHaveLength(2);
    expect(asShared.sharedBoards[0]!.labels).toEqual([
      { publicId: fromDev.publicId, name: "De Dev", colourCode: null },
    ]);
    const asHome = await caller(homeMember).byId({
      cardPublicId: card.publicId,
    });
    expect(asHome.labels.map((label) => label.name)).toEqual(["Bug"]);
    expect(asHome.sharedBoards).toEqual([]);

    // A copy on the home board takes the home labels only.
    await caller(owner).duplicate({
      cardPublicId: card.publicId,
      listPublicId: homeList.publicId,
      title: "Copy",
      copyLabels: true,
      copyMembers: false,
      copyChecklists: false,
    });

    // Unsharing takes the board's labels off the card, and logs it.
    await caller(owner).unshare({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
    });
    expect(await cardLabelIds(card.id)).toEqual([homeLabel.id]);
    expect(await boardView(homeBoard)).toEqual([
      { title: "From dev", labels: ["Bug"], homeLabels: [] },
      { title: "Copy", labels: ["Bug"], homeLabels: [] },
    ]);

    const activity = await caller(owner).getActivities({
      cardPublicId: card.publicId,
      limit: 20,
    });
    const labelActivity = activity.activities
      .filter((item) => item.type.startsWith("card.updated.label."))
      .map((item) => [item.type, item.label?.name]);
    expect(labelActivity).toEqual(
      expect.arrayContaining([
        ["card.updated.label.added", "Bug"],
        ["card.updated.label.added", "De Dev"],
        ["card.updated.label.removed", "De Dev"],
      ]),
    );
  });

  it("refuses to share with the home board twice or with a board the user cannot see", async () => {
    const card = await makeCard("Card", homeList.id);

    await expect(
      caller(owner).share({
        cardPublicId: card.publicId,
        boardPublicId: homeBoard.publicId,
        listPublicId: homeList.publicId,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller(owner).share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedTodo.publicId,
    });

    await expect(
      caller(owner).share({
        cardPublicId: card.publicId,
        boardPublicId: sharedBoard.publicId,
        listPublicId: sharedDone.publicId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const otherList = await makeList("ltother12345", otherBoard.id, 0);
    await expect(
      caller(sharedMember).share({
        cardPublicId: card.publicId,
        boardPublicId: otherBoard.publicId,
        listPublicId: otherList.publicId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  describe("changing the home board", () => {
    const ownIndices = async (listId: number) =>
      (
        await db
          .select({ title: schema.cards.title, index: schema.cards.index })
          .from(schema.cards)
          .where(eq(schema.cards.listId, listId))
      )
        .sort((a, b) => a.index - b.index)
        .map((card) => [card.title, card.index]);

    const homeBoardView = async () => {
      const board = await boardRepo.getByPublicId(
        db,
        homeBoard.publicId,
        owner.id,
        { members: [], labels: [], lists: [], dueDate: [], type: "regular" },
      );
      return board!.lists[0]!.cards.map((card) => [
        card.title,
        card.sharedFrom?.name ?? null,
      ]);
    };

    const shareInTheMiddle = async () => {
      await makeCard("Home A", homeList.id);
      const card = await makeCard("From dev", homeList.id);
      await makeCard("Home B", homeList.id);
      await makeCard("Own A", sharedTodo.id);
      await makeCard("Own B", sharedTodo.id);
      await caller(owner).share({
        cardPublicId: card.publicId,
        boardPublicId: sharedBoard.publicId,
        listPublicId: sharedTodo.publicId,
      });
      await caller(owner).update({
        cardPublicId: card.publicId,
        listPublicId: sharedTodo.publicId,
        index: 1,
      });
      return card;
    };

    it("swaps the home board with a shared board, keeping both boards' order", async () => {
      const card = await shareInTheMiddle();
      const cardNumber = async () =>
        (
          await db
            .select({ cardNumber: schema.cards.cardNumber })
            .from(schema.cards)
            .where(eq(schema.cards.id, card.id))
        )[0]?.cardNumber;
      const numberBefore = await cardNumber();

      await expect(
        caller(owner).setHomeBoard({
          cardPublicId: card.publicId,
          boardPublicId: sharedBoard.publicId,
        }),
      ).resolves.toEqual({
        boardPublicId: sharedBoard.publicId,
        listPublicId: sharedTodo.publicId,
      });

      const stored = await cardRepo.getByPublicId(db, card.publicId);
      expect(stored?.listId).toBe(sharedTodo.id);
      expect(await cardNumber()).toBe(numberBefore);

      expect(
        await cardBoardLinkRepo.getByCardAndBoard(db, {
          cardId: card.id,
          boardId: sharedBoard.id,
        }),
      ).toBeUndefined();
      expect(
        await cardBoardLinkRepo.getByCardAndBoard(db, {
          cardId: card.id,
          boardId: homeBoard.id,
        }),
      ).toMatchObject({ listId: homeList.id, index: 1 });

      // Both boards show the cards in the same order as before.
      expect((await sharedBoardView())[0]!.cards).toEqual([
        ["Own A", 0, null],
        ["From dev", 1, null],
        ["Own B", 2, null],
      ]);
      expect(await homeBoardView()).toEqual([
        ["Home A", null],
        ["From dev", "Exchanges"],
        ["Home B", null],
      ]);
      expect(await ownIndices(sharedTodo.id)).toEqual([
        ["Own A", 0],
        ["From dev", 1],
        ["Own B", 2],
      ]);
      expect(await ownIndices(homeList.id)).toEqual([
        ["Home A", 0],
        ["Home B", 1],
      ]);

      const activity = await caller(owner).getActivities({
        cardPublicId: card.publicId,
        limit: 20,
      });
      expect(
        activity.activities
          .filter((item) => item.type === "card.updated.board.home")
          .map((item) => [item.fromTitle, item.toTitle]),
      ).toEqual([["Dev", "Exchanges"]]);

      // And back again.
      await caller(owner).setHomeBoard({
        cardPublicId: card.publicId,
        boardPublicId: homeBoard.publicId,
      });
      expect((await cardRepo.getByPublicId(db, card.publicId))?.listId).toBe(
        homeList.id,
      );
      expect(await homeBoardView()).toEqual([
        ["Home A", null],
        ["From dev", null],
        ["Home B", null],
      ]);
      expect((await sharedBoardView())[0]!.cards).toEqual([
        ["Own A", 0, null],
        ["From dev", 1, "Dev"],
        ["Own B", 2, null],
      ]);
      expect(await cardBoardLinkRepo.getBoardsByCardId(db, card.id)).toEqual([
        expect.objectContaining({ id: sharedBoard.id, listId: sharedTodo.id }),
      ]);
    });

    it("keeps the card's labels, which follow the shared-card label rules", async () => {
      const makeLabel = async (
        publicId: string,
        name: string,
        boardId: number,
      ) => {
        const [label] = await db
          .insert(schema.labels)
          .values({ publicId, name, boardId, createdBy: owner.id })
          .returning();
        return label!;
      };
      const cardLabelIds = async (cardId: number) =>
        (
          await db
            .select({ labelId: schema.cardsToLabels.labelId })
            .from(schema.cardsToLabels)
            .where(eq(schema.cardsToLabels.cardId, cardId))
        )
          .map((row) => row.labelId)
          .sort();

      const homeLabel = await makeLabel("lbhome123456", "Bug", homeBoard.id);
      const fromDev = await makeLabel("lbfromdev123", "De Dev", sharedBoard.id);
      const homeMember = (await addMember("wmhome123456", [homeBoard.id])).user;
      const card = await makeCard("From dev", homeList.id);

      await caller(owner).addOrRemoveLabel({
        cardPublicId: card.publicId,
        labelPublicId: homeLabel.publicId,
      });
      await caller(owner).share({
        cardPublicId: card.publicId,
        boardPublicId: sharedBoard.publicId,
        listPublicId: sharedTodo.publicId,
      });
      await caller(sharedMember).addOrRemoveLabel({
        cardPublicId: card.publicId,
        labelPublicId: fromDev.publicId,
      });

      await caller(owner).setHomeBoard({
        cardPublicId: card.publicId,
        boardPublicId: sharedBoard.publicId,
      });

      const labelIds = [homeLabel.id, fromDev.id].sort();
      expect(await cardLabelIds(card.id)).toEqual(labelIds);
      // The existing check accepts every label the card carries.
      await db.transaction((tx) =>
        cardRepo.assertCardLabelBoardsMatch(
          tx,
          labelIds.map((labelId) => ({ cardId: card.id, labelId })),
        ),
      );

      // The old home labels are now those of a board the card is shared on:
      // only members of that board see them, next to the new home labels.
      const asHomeMember = await caller(homeMember).byId({
        cardPublicId: card.publicId,
      });
      expect(asHomeMember.canAccessHomeBoard).toBe(false);
      expect(asHomeMember.sharedBoards[0]!.publicId).toBe(homeBoard.publicId);
      expect(
        asHomeMember.labels.map((label) => [label.name, label.boardPublicId]),
      ).toEqual(
        expect.arrayContaining([
          ["Bug", homeBoard.publicId],
          ["De Dev", sharedBoard.publicId],
        ]),
      );
      expect(asHomeMember.labels).toHaveLength(2);
      const asSharedMember = await caller(sharedMember).byId({
        cardPublicId: card.publicId,
      });
      expect(asSharedMember.canAccessHomeBoard).toBe(true);
      expect(asSharedMember.labels.map((label) => label.name)).toEqual([
        "De Dev",
      ]);

      // Label edits follow the new roles of each board.
      await expect(
        caller(homeMember).addOrRemoveLabel({
          cardPublicId: card.publicId,
          labelPublicId: homeLabel.publicId,
        }),
      ).resolves.toEqual({ newLabel: false });
      await expect(
        caller(homeMember).addOrRemoveLabel({
          cardPublicId: card.publicId,
          labelPublicId: fromDev.publicId,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      // Unsharing the old home board now takes its labels off.
      await caller(owner).unshare({
        cardPublicId: card.publicId,
        boardPublicId: homeBoard.publicId,
      });
      expect(await cardLabelIds(card.id)).toEqual([fromDev.id]);
    });

    it("only accepts a board the card is shared with", async () => {
      const card = await makeCard("Card", homeList.id);
      await makeList("ltother12345", otherBoard.id, 0);

      await expect(
        caller(owner).setHomeBoard({
          cardPublicId: card.publicId,
          boardPublicId: otherBoard.publicId,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller(owner).setHomeBoard({
          cardPublicId: card.publicId,
          boardPublicId: homeBoard.publicId,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller(owner).setHomeBoard({
          cardPublicId: card.publicId,
          boardPublicId: "bdunknown123",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await cardRepo.getByPublicId(db, card.publicId))?.listId).toBe(
        homeList.id,
      );
    });

    it("takes access to both the home board and the target board", async () => {
      const card = await makeCard("Card", homeList.id);
      await caller(owner).share({
        cardPublicId: card.publicId,
        boardPublicId: sharedBoard.publicId,
        listPublicId: sharedTodo.publicId,
      });
      const homeMember = (await addMember("wmhome123456", [homeBoard.id])).user;
      const setHome = (user: {
        id: string;
        name: string | null;
        email: string;
      }) =>
        caller(user).setHomeBoard({
          cardPublicId: card.publicId,
          boardPublicId: sharedBoard.publicId,
        });

      // On the target board only, on the home board only, on neither.
      await expect(setHome(sharedMember)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(setHome(homeMember)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(setHome(outsider)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      expect((await cardRepo.getByPublicId(db, card.publicId))?.listId).toBe(
        homeList.id,
      );
      expect(
        (
          await db
            .select({ type: schema.cardActivities.type })
            .from(schema.cardActivities)
            .where(eq(schema.cardActivities.cardId, card.id))
        ).map((item) => item.type),
      ).not.toContain("card.updated.board.home");

      // On both boards, it works.
      const bothMember = (
        await addMember("wmboth123456", [homeBoard.id, sharedBoard.id])
      ).user;
      await expect(setHome(bothMember)).resolves.toMatchObject({
        boardPublicId: sharedBoard.publicId,
      });
    });

    it("refuses template boards", async () => {
      const [template] = await db
        .insert(schema.boards)
        .values({
          publicId: "bdtemplate12",
          name: "Template",
          slug: "bdtemplate12",
          workspaceId: workspace.id,
          createdBy: owner.id,
          type: "template",
        })
        .returning();
      const templateList = await makeList("lttemplate12", template!.id, 0);

      // A link to a template board cannot be made through the API; insert
      // one to make sure it is refused anyway.
      const card = await makeCard("Card", homeList.id);
      await db.insert(schema.cardBoardLinks).values({
        cardId: card.id,
        boardId: template!.id,
        listId: templateList.id,
        index: 0,
        createdBy: owner.id,
      });
      await expect(
        caller(owner).setHomeBoard({
          cardPublicId: card.publicId,
          boardPublicId: template!.publicId,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // Nor can a template card move to a regular board.
      const templateCard = await makeCard("Template card", templateList.id);
      await db.insert(schema.cardBoardLinks).values({
        cardId: templateCard.id,
        boardId: sharedBoard.id,
        listId: sharedTodo.id,
        index: 0,
        createdBy: owner.id,
      });
      await expect(
        caller(owner).setHomeBoard({
          cardPublicId: templateCard.publicId,
          boardPublicId: sharedBoard.publicId,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
