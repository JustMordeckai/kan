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
});
