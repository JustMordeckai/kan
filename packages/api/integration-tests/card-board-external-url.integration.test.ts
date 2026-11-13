import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardMemberRepo from "@kan/db/repository/boardMember.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardBoardLinkRepo from "@kan/db/repository/cardBoardLink.repo";
import * as schema from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { boardRouter } from "../src/routers/board";
import { cardRouter } from "../src/routers/card";
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

const homeThread = "https://discord.com/channels/123456789/111111111";
const sharedThread = "https://discord.com/channels/123456789/222222222";

type User = { id: string; name: string | null; email: string };

describe("card link per shared board", () => {
  let db: TestDbClient;
  let owner: User;
  let workspace: { id: number; publicId: string };
  let homeBoard: { id: number; publicId: string };
  let sharedBoard: { id: number; publicId: string };
  let otherBoard: { id: number; publicId: string };
  let homeList: { id: number; publicId: string };
  let sharedList: { id: number; publicId: string };
  let card: { id: number; publicId: string };

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

  const makeList = async (publicId: string, boardId: number) => {
    const [list] = await db
      .insert(schema.lists)
      .values({
        publicId,
        name: publicId,
        index: 0,
        boardId,
        createdBy: owner.id,
      })
      .returning();
    return list!;
  };

  const addMember = async (
    publicId: string,
    boardIds: number[],
    role: "member" | "guest" = "member",
  ) => {
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
        role,
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
    return user!;
  };

  const ctxFor = (user: User) =>
    ({
      db,
      user: {
        ...user,
        name: user.name ?? "",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      headers: new Headers(),
    }) as never;

  const cards = (user = owner) => cardRouter.createCaller(ctxFor(user));
  const boards = (user = owner) => boardRouter.createCaller(ctxFor(user));

  const setLink = (externalUrl: string | null, user = owner) =>
    cards(user).updateSharedBoard({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      externalUrl,
    });

  const linkOn = async (boardId: number) =>
    (
      await cardBoardLinkRepo.getByCardAndBoard(db, {
        cardId: card.id,
        boardId,
      })
    )?.externalUrl;

  const cardUrl = async () =>
    (await cardRepo.getByPublicId(db, card.publicId))?.externalUrl;

  const boardCard = async (
    boardPublicId: string,
    cardView: "full" | "summary" = "full",
  ) =>
    (await boards().byId({ boardPublicId, cardView })).lists
      .flatMap((list) => list.cards)
      .find((c) => c.publicId === card.publicId);

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    owner = seeded.user;
    workspace = seeded.workspace;

    homeBoard = await makeBoard("bdhome123456", "Dev");
    sharedBoard = await makeBoard("bdshared1234", "Exchanges");
    otherBoard = await makeBoard("bdother12345", "Mapping");
    homeList = await makeList("lthome123456", homeBoard.id);
    sharedList = await makeList("ltshared1234", sharedBoard.id);

    const { publicId } = await cards().create({
      title: "Thread card",
      description: "",
      listPublicId: homeList.publicId,
      labelPublicIds: [],
      memberPublicIds: [],
      position: "end",
      externalUrl: homeThread,
    });
    card = (await cardRepo.getByPublicId(db, publicId))!;

    await cards().share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedList.publicId,
    });
  });

  it("sets, changes and clears the link of a share without touching the card's own", async () => {
    expect(await linkOn(sharedBoard.id)).toBeNull();

    expect(await setLink(sharedThread)).toEqual({
      boardPublicId: sharedBoard.publicId,
      externalUrl: sharedThread,
    });
    expect(await linkOn(sharedBoard.id)).toBe(sharedThread);

    const otherUrl = "https://example.com/tickets/42";
    await setLink(`  ${otherUrl}  `);
    expect(await linkOn(sharedBoard.id)).toBe(otherUrl);

    expect(await setLink(null)).toEqual({
      boardPublicId: sharedBoard.publicId,
      externalUrl: null,
    });
    expect(await linkOn(sharedBoard.id)).toBeNull();
    expect(await cardUrl()).toBe(homeThread);
  });

  it.each([
    ["an http link", "http://discord.com/channels/1/2"],
    ["a javascript: link", "javascript:alert(1)"],
    ["text that is not a link", "not a link"],
    ["an empty string", ""],
    ["a link over 2048 characters", `https://example.com/${"a".repeat(2029)}`],
  ])("rejects %s and leaves the share unchanged", async (_label, value) => {
    await setLink(sharedThread);

    await expect(setLink(value)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await linkOn(sharedBoard.id)).toBe(sharedThread);
  });

  it("answers NOT_FOUND for a board the card is not shared on", async () => {
    for (const boardPublicId of [homeBoard.publicId, otherBoard.publicId]) {
      await expect(
        cards().updateSharedBoard({
          cardPublicId: card.publicId,
          boardPublicId,
          externalUrl: sharedThread,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      cards().updateSharedBoard({
        cardPublicId: "cdunknown123",
        boardPublicId: sharedBoard.publicId,
        externalUrl: sharedThread,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await cardUrl()).toBe(homeThread);
  });

  it("takes being on the shared board, not only on the card's home board", async () => {
    const homeMember = await addMember("wmhome123456", [homeBoard.id]);
    const sharedMember = await addMember("wmshared1234", [sharedBoard.id]);
    const outsider = await addMember("wmother12345", [otherBoard.id]);

    for (const user of [homeMember, outsider]) {
      await expect(setLink(sharedThread, user)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expect(await linkOn(sharedBoard.id)).toBeNull();

    await setLink(sharedThread, sharedMember);
    expect(await linkOn(sharedBoard.id)).toBe(sharedThread);
  });

  it("takes the card:edit permission", async () => {
    const guest = await addMember("wmguest12345", [sharedBoard.id], "guest");

    await expect(setLink(sharedThread, guest)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await linkOn(sharedBoard.id)).toBeNull();
  });

  it("records an activity naming the board only when the link changes", async () => {
    await setLink(sharedThread);
    await setLink(sharedThread);
    await setLink(null);

    const activities = await db
      .select({
        type: schema.cardActivities.type,
        toTitle: schema.cardActivities.toTitle,
      })
      .from(schema.cardActivities)
      .where(eq(schema.cardActivities.cardId, card.id));

    expect(
      activities.filter(
        ({ type }) => type === "card.updated.board.externalUrl",
      ),
    ).toEqual([
      { type: "card.updated.board.externalUrl", toTitle: "Exchanges" },
      { type: "card.updated.board.externalUrl", toTitle: "Exchanges" },
    ]);
  });

  it("exposes boardExternalUrl on the shared board only, in every card view", async () => {
    for (const cardView of ["full", "summary"] as const) {
      expect(await boardCard(sharedBoard.publicId, cardView)).toMatchObject({
        externalUrl: homeThread,
        boardExternalUrl: null,
      });
    }

    await setLink(sharedThread);

    for (const cardView of ["full", "summary"] as const) {
      expect(await boardCard(sharedBoard.publicId, cardView)).toMatchObject({
        externalUrl: homeThread,
        boardExternalUrl: sharedThread,
      });
      expect(await boardCard(homeBoard.publicId, cardView)).toMatchObject({
        externalUrl: homeThread,
        boardExternalUrl: null,
      });
    }
  });

  it("lists each share's link on the card", async () => {
    await setLink(sharedThread);

    const detail = await cards().byId({ cardPublicId: card.publicId });
    expect(detail.externalUrl).toBe(homeThread);
    expect(detail.sharedBoards).toEqual([
      expect.objectContaining({
        publicId: sharedBoard.publicId,
        externalUrl: sharedThread,
      }),
    ]);
  });

  it("swaps the links when the shared board becomes the origin board, and back", async () => {
    await setLink(sharedThread);

    await cards().setHomeBoard({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
    });

    expect(await cardUrl()).toBe(sharedThread);
    expect(await linkOn(sharedBoard.id)).toBeUndefined();
    expect(await linkOn(homeBoard.id)).toBe(homeThread);
    expect(await boardCard(sharedBoard.publicId)).toMatchObject({
      externalUrl: sharedThread,
      boardExternalUrl: null,
    });
    expect(await boardCard(homeBoard.publicId)).toMatchObject({
      externalUrl: sharedThread,
      boardExternalUrl: homeThread,
    });
    const detail = await cards().byId({ cardPublicId: card.publicId });
    expect(detail.sharedBoards).toEqual([
      expect.objectContaining({
        publicId: homeBoard.publicId,
        externalUrl: homeThread,
      }),
    ]);

    await cards().setHomeBoard({
      cardPublicId: card.publicId,
      boardPublicId: homeBoard.publicId,
    });

    expect(await cardUrl()).toBe(homeThread);
    expect(await linkOn(sharedBoard.id)).toBe(sharedThread);
    expect(await linkOn(homeBoard.id)).toBeUndefined();
  });

  it("moves an empty share link onto the card too", async () => {
    await cards().setHomeBoard({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
    });

    expect(await cardUrl()).toBeNull();
    expect(await linkOn(homeBoard.id)).toBe(homeThread);
  });

  it("drops the link with the share", async () => {
    await setLink(sharedThread);

    await cards().unshare({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
    });
    expect(await linkOn(sharedBoard.id)).toBeUndefined();
    await expect(setLink(sharedThread)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await cards().share({
      cardPublicId: card.publicId,
      boardPublicId: sharedBoard.publicId,
      listPublicId: sharedList.publicId,
    });
    expect(await linkOn(sharedBoard.id)).toBeNull();
    expect(await cardUrl()).toBe(homeThread);
  });
});
