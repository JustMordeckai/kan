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

const threadUrl = "https://discord.com/channels/123456789/987654321";

describe("card external link", () => {
  let db: TestDbClient;
  let owner: { id: string; name: string | null; email: string };
  let workspace: { id: number; publicId: string };
  let homeBoard: { id: number; publicId: string };
  let sharedBoard: { id: number; publicId: string };
  let homeList: { id: number; publicId: string };
  let sharedList: { id: number; publicId: string };

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

  const ctxFor = (user: { id: string; name: string | null; email: string }) =>
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
  const boardsFor = (user = owner) => boardRouter.createCaller(ctxFor(user));

  const createCard = (externalUrl?: string | null) =>
    cards().create({
      title: "Thread card",
      description: "",
      listPublicId: homeList.publicId,
      labelPublicIds: [],
      memberPublicIds: [],
      position: "end",
      ...(externalUrl !== undefined && { externalUrl }),
    });

  const storedUrl = async (cardPublicId: string) =>
    (await cardRepo.getByPublicId(db, cardPublicId))?.externalUrl;

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    owner = seeded.user;
    workspace = seeded.workspace;

    homeBoard = await makeBoard("bdhome123456", "Dev");
    sharedBoard = await makeBoard("bdshared1234", "Exchanges");
    homeList = await makeList("lthome123456", homeBoard.id);
    sharedList = await makeList("ltshared1234", sharedBoard.id);
  });

  it("stores the link given on creation and returns it on read", async () => {
    const { publicId } = await createCard(threadUrl);

    expect(await storedUrl(publicId)).toBe(threadUrl);

    const card = await cards().byId({ cardPublicId: publicId });
    expect(card.externalUrl).toBe(threadUrl);
  });

  it("creates cards without a link by default", async () => {
    const { publicId } = await createCard();

    expect(await storedUrl(publicId)).toBeNull();
    expect((await cards().byId({ cardPublicId: publicId })).externalUrl).toBe(
      null,
    );
  });

  it("rejects a non-https link on creation", async () => {
    await expect(
      createCard("http://discord.com/channels/1/2"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sets, changes and clears the link on update", async () => {
    const { publicId } = await createCard();

    const set = await cards().update({
      cardPublicId: publicId,
      externalUrl: threadUrl,
    });
    expect(set.externalUrl).toBe(threadUrl);
    expect(await storedUrl(publicId)).toBe(threadUrl);

    const otherUrl = "https://example.com/tickets/42";
    await cards().update({ cardPublicId: publicId, externalUrl: otherUrl });
    expect(await storedUrl(publicId)).toBe(otherUrl);

    const cleared = await cards().update({
      cardPublicId: publicId,
      externalUrl: null,
    });
    expect(cleared.externalUrl).toBeNull();
    expect(await storedUrl(publicId)).toBeNull();
  });

  it("keeps the link when other fields are updated", async () => {
    const { publicId } = await createCard(threadUrl);

    const result = await cards().update({
      cardPublicId: publicId,
      title: "Renamed",
    });

    expect(result.externalUrl).toBe(threadUrl);
    expect(await storedUrl(publicId)).toBe(threadUrl);
  });

  it("trims surrounding spaces", async () => {
    const { publicId } = await createCard();

    await cards().update({
      cardPublicId: publicId,
      externalUrl: `  ${threadUrl}  `,
    });

    expect(await storedUrl(publicId)).toBe(threadUrl);
  });

  it.each([
    ["an http link", "http://discord.com/channels/1/2"],
    ["a javascript: link", "javascript:alert(1)"],
    ["a data: link", "data:text/html,<script>alert(1)</script>"],
    ["text that is not a link", "not a link"],
    ["an empty string", ""],
    ["a link over 2048 characters", `https://example.com/${"a".repeat(2029)}`],
  ])("rejects %s and leaves the card unchanged", async (_label, value) => {
    const { publicId } = await createCard(threadUrl);

    await expect(
      cards().update({ cardPublicId: publicId, externalUrl: value }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await storedUrl(publicId)).toBe(threadUrl);
  });

  it("accepts a link of exactly 2048 characters", async () => {
    const { publicId } = await createCard();
    const longUrl = `https://example.com/${"a".repeat(2028)}`;
    expect(longUrl).toHaveLength(2048);

    await cards().update({ cardPublicId: publicId, externalUrl: longUrl });

    expect(await storedUrl(publicId)).toBe(longUrl);
  });

  it("records an activity only when the link changes", async () => {
    const { publicId } = await createCard();
    const card = await cardRepo.getByPublicId(db, publicId);

    await cards().update({ cardPublicId: publicId, externalUrl: threadUrl });
    await cards().update({ cardPublicId: publicId, externalUrl: threadUrl });
    await cards().update({ cardPublicId: publicId, externalUrl: null });

    const activities = await db
      .select({ type: schema.cardActivities.type })
      .from(schema.cardActivities)
      .where(eq(schema.cardActivities.cardId, card!.id));

    expect(
      activities.filter(({ type }) => type === "card.updated.externalUrl"),
    ).toHaveLength(2);
  });

  it("exposes the link and member public IDs in the board payload, shared cards included", async () => {
    const { publicId } = await createCard(threadUrl);
    const card = await cardRepo.getByPublicId(db, publicId);
    const [ownerMember] = await db
      .select({
        id: schema.workspaceMembers.id,
        publicId: schema.workspaceMembers.publicId,
      })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, owner.id));
    await cardRepo.bulkCreateCardWorkspaceMemberRelationships(db, [
      { cardId: card!.id, workspaceMemberId: ownerMember!.id },
    ]);
    await cardBoardLinkRepo.create(db, {
      cardId: card!.id,
      boardId: sharedBoard.id,
      listId: sharedList.id,
      createdBy: owner.id,
    });

    for (const [boardPublicId, sharedFrom] of [
      [homeBoard.publicId, null],
      [sharedBoard.publicId, "Dev"],
    ] as const) {
      for (const cardView of ["full", "summary"] as const) {
        const board = await boardsFor().byId({ boardPublicId, cardView });
        const boardCard = board.lists
          .flatMap((list) => list.cards)
          .find((c) => c.publicId === publicId);

        expect(boardCard).toMatchObject({
          externalUrl: threadUrl,
          sharedFrom: sharedFrom ? { name: sharedFrom } : null,
          members: [
            expect.objectContaining({ publicId: ownerMember!.publicId }),
          ],
        });
      }
    }

    const detail = await cards().byId({ cardPublicId: publicId });
    expect(detail.members).toEqual([
      expect.objectContaining({ publicId: ownerMember!.publicId }),
    ]);
  });

  it("lets a member of a board the card is shared on set the link", async () => {
    const { publicId } = await createCard();
    const card = await cardRepo.getByPublicId(db, publicId);
    await cardBoardLinkRepo.create(db, {
      cardId: card!.id,
      boardId: sharedBoard.id,
      listId: sharedList.id,
      createdBy: owner.id,
    });

    const [user] = await db
      .insert(schema.users)
      .values({
        id: crypto.randomUUID(),
        name: "Shared member",
        email: "shared@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const [member] = await db
      .insert(schema.workspaceMembers)
      .values({
        publicId: "wmshared1234",
        email: user!.email,
        workspaceId: workspace.id,
        userId: user!.id,
        createdBy: owner.id,
        role: "member",
        status: "active",
        createdAt: new Date(),
      })
      .returning();
    await boardMemberRepo.add(db, {
      boardId: sharedBoard.id,
      workspaceMemberId: member!.id,
      role: "member",
      createdBy: owner.id,
    });

    await cards(user!).update({
      cardPublicId: publicId,
      externalUrl: threadUrl,
    });

    expect(await storedUrl(publicId)).toBe(threadUrl);
  });
});
