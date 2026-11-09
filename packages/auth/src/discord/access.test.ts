import { afterEach, describe, expect, it } from "vitest";

import { computeBoardMembershipChanges, hasAllowedRole } from "./access";
import { getDiscordRoleAccessConfig, parseRoleIds } from "./config";

describe("hasAllowedRole", () => {
  it("allows a member holding one of the allowed roles", () => {
    expect(hasAllowedRole(["1", "2"], ["2", "3"])).toBe(true);
  });

  it("refuses a member without any allowed role", () => {
    expect(hasAllowedRole(["1"], ["2", "3"])).toBe(false);
  });

  it("refuses a user who is not in the guild", () => {
    expect(hasAllowedRole(null, ["2"])).toBe(false);
  });

  it("refuses everyone when no role is allowed", () => {
    expect(hasAllowedRole(["1", "2"], [])).toBe(false);
  });
});

describe("computeBoardMembershipChanges", () => {
  const board = (
    boardId: number,
    discordRoleIds: string[],
    role: "admin" | "member" | null,
  ) => ({ boardId, workspaceMemberId: 10, discordRoleIds, role });

  it("adds the user to boards one of their roles grants", () => {
    const changes = computeBoardMembershipChanges(
      [board(1, ["staff"], null), board(2, ["dev"], null)],
      ["staff"],
    );

    expect(changes.add).toEqual([{ boardId: 1, workspaceMemberId: 10 }]);
    expect(changes.remove).toEqual([]);
  });

  it("removes plain members who lost every granting role", () => {
    const changes = computeBoardMembershipChanges(
      [board(1, ["staff"], "member"), board(2, ["dev", "staff"], "member")],
      ["dev"],
    );

    expect(changes.add).toEqual([]);
    expect(changes.remove).toEqual([{ boardId: 1, workspaceMemberId: 10 }]);
  });

  it("never removes a board admin", () => {
    const changes = computeBoardMembershipChanges(
      [board(1, ["staff"], "admin")],
      [],
    );

    expect(changes).toEqual({ add: [], remove: [] });
  });

  it("leaves existing memberships that are still granted", () => {
    const changes = computeBoardMembershipChanges(
      [board(1, ["staff"], "member"), board(2, ["staff"], "admin")],
      ["staff"],
    );

    expect(changes).toEqual({ add: [], remove: [] });
  });
});

describe("parseRoleIds", () => {
  it("trims, dedupes and drops anything that is not a Discord id", () => {
    expect(parseRoleIds(" 123, 456 ,123,,abc, 7e3 ")).toEqual(["123", "456"]);
  });

  it("returns an empty list for an empty value", () => {
    expect(parseRoleIds(undefined)).toEqual([]);
    expect(parseRoleIds("")).toEqual([]);
  });
});

describe("getDiscordRoleAccessConfig", () => {
  const keys = [
    "DISCORD_GUILD_ID",
    "DISCORD_BOT_TOKEN",
    "DISCORD_ALLOWED_ROLE_IDS",
    "DISCORD_WORKSPACE_PUBLIC_ID",
  ];

  afterEach(() => {
    for (const key of keys) delete process.env[key];
  });

  it("is off when DISCORD_GUILD_ID is not set", () => {
    process.env.DISCORD_BOT_TOKEN = "token";
    expect(getDiscordRoleAccessConfig()).toBeNull();
  });

  it("reads the settings when DISCORD_GUILD_ID is set", () => {
    process.env.DISCORD_GUILD_ID = "100";
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_ALLOWED_ROLE_IDS = "1,2";
    process.env.DISCORD_WORKSPACE_PUBLIC_ID = "abcdefghijkl";

    expect(getDiscordRoleAccessConfig()).toEqual({
      guildId: "100",
      botToken: "token",
      allowedRoleIds: ["1", "2"],
      workspacePublicId: "abcdefghijkl",
      exemptEmails: [],
    });
  });
});
