import { describe, expect, it } from "vitest";

import type {
  BoardAccessBoardInput,
  BoardAccessMemberInput,
  BoardAccessMembershipInput,
} from "./memberBoardAccess";
import {
  collectBoardDiscordRoleIds,
  computeMemberBoardAccess,
} from "./memberBoardAccess";

const addedAt = new Date("2026-11-01T10:00:00Z");

const member = (
  id: number,
  overrides: Partial<BoardAccessMemberInput> = {},
): BoardAccessMemberInput => ({
  id,
  publicId: `member${id}`.padEnd(12, "0"),
  email: `user${id}@example.com`,
  role: "member",
  discordRoleIds: [],
  discordRolesSyncedAt: addedAt,
  userId: `user-${id}`,
  userName: `User ${id}`,
  userEmail: `user${id}@example.com`,
  userImage: null,
  hasDiscordAccount: true,
  ...overrides,
});

const board = (
  id: number,
  discordRoleIds: string[] | null,
): BoardAccessBoardInput => ({
  id,
  publicId: `board${id}`.padEnd(12, "0"),
  name: `Board ${id}`,
  isArchived: false,
  discordRoleIds,
});

const membership = (
  boardId: number,
  workspaceMemberId: number,
  overrides: Partial<BoardAccessMembershipInput> = {},
): BoardAccessMembershipInput => ({
  boardId,
  workspaceMemberId,
  role: "member",
  createdAt: addedAt,
  createdBy: null,
  addedByName: null,
  addedByEmail: null,
  ...overrides,
});

const discordRoles = [
  { roleId: "10", name: "Staff", colour: 0xe74c3c, position: 5 },
  { roleId: "11", name: "Dev", colour: 0, position: 2 },
];

const compute = (args: {
  members: BoardAccessMemberInput[];
  boards: BoardAccessBoardInput[];
  memberships: BoardAccessMembershipInput[];
  exemptEmails?: string[];
}) =>
  computeMemberBoardAccess({
    discordRoles,
    exemptEmails: [],
    ...args,
  });

describe("computeMemberBoardAccess", () => {
  it("explains a membership by every board role the member holds", () => {
    const result = compute({
      members: [member(1, { discordRoleIds: ["11", "10", "99"] })],
      boards: [board(1, ["11", "10"])],
      memberships: [membership(1, 1)],
    });

    expect(result.members[0]?.boards).toEqual([
      {
        boardPublicId: "board1000000",
        name: "Board 1",
        isArchived: false,
        boardRole: "member",
        reasons: [
          {
            type: "discord_role",
            roleId: "10",
            name: "Staff",
            colour: 0xe74c3c,
          },
          { type: "discord_role", roleId: "11", name: "Dev", colour: 0 },
        ],
      },
    ]);
  });

  it("shows a manual addition with its author on a board without roles", () => {
    const result = compute({
      members: [member(1)],
      boards: [board(1, null)],
      memberships: [
        membership(1, 1, {
          createdBy: "user-9",
          addedByName: "Admin",
          addedByEmail: "admin@example.com",
        }),
      ],
    });

    expect(result.members[0]?.boards[0]?.reasons).toEqual([
      {
        type: "manual",
        addedBy: { name: "Admin", email: "admin@example.com" },
        addedAt,
      },
    ]);
  });

  it("shows a manual addition on a role board the member has no role for", () => {
    const result = compute({
      members: [member(1, { discordRoleIds: ["11"] })],
      boards: [board(1, ["10"])],
      memberships: [
        membership(1, 1, {
          role: "admin",
          createdBy: "user-9",
          addedByName: null,
          addedByEmail: "admin@example.com",
        }),
      ],
    });

    expect(result.members[0]?.boards[0]).toMatchObject({
      boardRole: "admin",
      reasons: [
        {
          type: "manual",
          addedBy: { name: null, email: "admin@example.com" },
          addedAt,
        },
      ],
    });
  });

  it("attributes an authorless member row on a role board to the role sync once the role is gone", () => {
    const result = compute({
      members: [member(1, { discordRoleIds: ["11"] })],
      boards: [board(1, ["10"])],
      memberships: [membership(1, 1)],
    });

    expect(result.members[0]?.boards[0]?.reasons).toEqual([
      { type: "discord_sync", addedAt },
    ]);
  });

  it("attributes it to the role sync while the member's roles are unknown", () => {
    const result = compute({
      members: [
        member(1, { discordRoleIds: null, discordRolesSyncedAt: null }),
      ],
      boards: [board(1, ["10"])],
      memberships: [membership(1, 1)],
    });

    expect(result.members[0]).toMatchObject({
      discordRolesSyncedAt: null,
      boards: [{ reasons: [{ type: "discord_sync", addedAt }] }],
    });
  });

  it("keeps an authorless board admin as a manual addition without author", () => {
    const result = compute({
      members: [member(1)],
      boards: [board(1, ["10"])],
      memberships: [membership(1, 1, { role: "admin" })],
    });

    expect(result.members[0]?.boards[0]?.reasons).toEqual([
      { type: "manual", addedBy: null, addedAt },
    ]);
  });

  it("gives workspace admins every board, with their board membership if any", () => {
    const result = compute({
      members: [member(1, { role: "admin", discordRoleIds: ["10"] })],
      boards: [board(1, ["10"]), board(2, null)],
      memberships: [membership(1, 1)],
    });

    expect(result.members[0]?.boards).toMatchObject([
      {
        boardPublicId: "board1000000",
        boardRole: "member",
        reasons: [
          { type: "workspace_admin" },
          { type: "discord_role", roleId: "10" },
        ],
      },
      {
        boardPublicId: "board2000000",
        boardRole: null,
        reasons: [{ type: "workspace_admin" }],
      },
    ]);
  });

  it("leaves out boards the member cannot access, even with a matching role", () => {
    const result = compute({
      members: [member(1, { discordRoleIds: ["10"] })],
      boards: [board(1, ["10"]), board(2, null)],
      memberships: [],
    });

    expect(result.members[0]?.boards).toEqual([]);
  });

  it("flags exempt accounts and keeps their manual additions", () => {
    const result = compute({
      members: [
        member(1, {
          userEmail: "Service@Example.com",
          discordRoleIds: null,
          discordRolesSyncedAt: null,
          hasDiscordAccount: false,
        }),
      ],
      boards: [board(1, ["10"])],
      memberships: [
        membership(1, 1, {
          createdBy: "user-9",
          addedByName: "Admin",
          addedByEmail: "admin@example.com",
        }),
      ],
      exemptEmails: ["service@example.com"],
    });

    expect(result.members[0]).toMatchObject({
      email: "Service@Example.com",
      discordExempt: true,
      hasDiscordAccount: false,
      boards: [{ reasons: [{ type: "manual", addedAt }] }],
    });
  });

  it("lists each board's roles by name, highest first, unknown roles last", () => {
    const result = compute({
      members: [],
      boards: [board(1, ["404", "11", "10", "11"])],
      memberships: [],
    });

    expect(result.boards).toEqual([
      {
        boardPublicId: "board1000000",
        name: "Board 1",
        isArchived: false,
        discordRoles: [
          { roleId: "10", name: "Staff", colour: 0xe74c3c },
          { roleId: "11", name: "Dev", colour: 0 },
          { roleId: "404", name: null, colour: null },
        ],
      },
    ]);
  });
});

describe("collectBoardDiscordRoleIds", () => {
  it("dedupes the role ids of every board", () => {
    expect(
      collectBoardDiscordRoleIds([
        { discordRoleIds: ["1", "2"] },
        { discordRoleIds: null },
        { discordRoleIds: ["2", "3"] },
      ]),
    ).toEqual(["1", "2", "3"]);
  });
});
