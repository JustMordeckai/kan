import { APIError } from "better-auth/api";
import { env } from "next-runtime-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as discordRepo from "@kan/db/repository/discord.repo";
import * as memberRepo from "@kan/db/repository/member.repo";

import { authorizeDiscordSession, isDiscordUserAllowed } from "./discord/sync";
import { createDatabaseHooks } from "./hooks";

vi.mock("next-runtime-env", () => ({
  env: vi.fn(),
}));

vi.mock("@kan/db/repository/member.repo", () => ({
  getByEmailAndStatus: vi.fn(),
  getByPublicId: vi.fn(),
  acceptInvite: vi.fn(),
}));

vi.mock("@kan/db/repository/user.repo", () => ({
  update: vi.fn(),
}));

vi.mock("@kan/db/repository/discord.repo", () => ({
  deleteUserIfUnused: vi.fn(),
}));

vi.mock("./discord/sync", () => ({
  authorizeDiscordSession: vi.fn(),
  isDiscordUserAllowed: vi.fn(),
}));

vi.mock("@kan/email", () => ({
  subscriber: null,
}));

vi.mock("@kan/shared", () => ({
  createS3Client: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: vi.fn(),
}));

const mockEnv = env as ReturnType<typeof vi.fn>;
const mockGetByEmailAndStatus = memberRepo.getByEmailAndStatus as ReturnType<
  typeof vi.fn
>;

const db = {} as Parameters<typeof createDatabaseHooks>[0];

const fakeUser = {
  id: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  email: "test@example.com",
  emailVerified: false,
  name: "Test User",
};

describe("createDatabaseHooks", () => {
  const hooks = createDatabaseHooks(db);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("user.create.before", () => {
    it("allows sign-up when DISABLE_SIGN_UP is not set", async () => {
      mockEnv.mockReturnValue(undefined);

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).not.toHaveBeenCalled();
    });

    it("allows sign-up when DISABLE_SIGN_UP is false", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "false" : undefined,
      );

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).not.toHaveBeenCalled();
    });

    it("blocks sign-up when disabled and user has no pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      mockGetByEmailAndStatus.mockResolvedValue(undefined);

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(false);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "test@example.com",
        "invited",
      );
    });

    it("allows sign-up when disabled but user has a pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-1",
        email: "test@example.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "test@example.com",
        "invited",
      );
    });

    it("blocks sign-up when disabled and invitation exists but domain is not allowed", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      process.env.BETTER_AUTH_ALLOWED_DOMAINS = "acme.com";
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-1",
        email: "test@example.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(false);

      delete process.env.BETTER_AUTH_ALLOWED_DOMAINS;
    });

    // The user.create.before hook fires for ALL sign-up paths including
    // OIDC/social — verify invite bypass works regardless of auth method.
    it("allows OIDC/social sign-up when disabled but user has a pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      const oidcUser = {
        ...fakeUser,
        id: "user-oidc",
        email: "sso@corp.com",
        image: "https://provider.com/avatar.jpg",
      };
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-2",
        email: "sso@corp.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(oidcUser, {});
      expect(result).toBe(true);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "sso@corp.com",
        "invited",
      );
    });

    it("blocks OIDC/social sign-up when disabled and user has no pending invitation", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      const oidcUser = {
        ...fakeUser,
        id: "user-oidc",
        email: "random@external.com",
        image: "https://provider.com/avatar.jpg",
      };
      mockGetByEmailAndStatus.mockResolvedValue(undefined);

      const result = await hooks.user.create.before(oidcUser, {});
      expect(result).toBe(false);
      expect(mockGetByEmailAndStatus).toHaveBeenCalledWith(
        db,
        "random@external.com",
        "invited",
      );
    });

    it("allows sign-up when disabled, invitation exists, and domain is allowed", async () => {
      mockEnv.mockImplementation((key: string) =>
        key === "NEXT_PUBLIC_DISABLE_SIGN_UP" ? "true" : undefined,
      );
      process.env.BETTER_AUTH_ALLOWED_DOMAINS = "example.com";
      mockGetByEmailAndStatus.mockResolvedValue({
        id: "member-1",
        email: "test@example.com",
        status: "invited",
      });

      const result = await hooks.user.create.before(fakeUser, {});
      expect(result).toBe(true);

      delete process.env.BETTER_AUTH_ALLOWED_DOMAINS;
    });
  });

  describe("Discord role access", () => {
    const mockIsDiscordUserAllowed = vi.mocked(isDiscordUserAllowed);
    const mockAuthorizeDiscordSession = vi.mocked(authorizeDiscordSession);
    const mockDeleteUserIfUnused = vi.mocked(discordRepo.deleteUserIfUnused);

    const discordAccount = {
      providerId: "discord",
      accountId: "42",
      userId: "user-1",
    };

    afterEach(() => {
      delete process.env.DISCORD_GUILD_ID;
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.DISCORD_ALLOWED_ROLE_IDS;
    });

    describe("when DISCORD_GUILD_ID is not set", () => {
      it("does not check accounts", async () => {
        await expect(
          hooks.account.create.before(discordAccount, {}),
        ).resolves.toBe(true);
        expect(mockIsDiscordUserAllowed).not.toHaveBeenCalled();
      });

      it("does not check sessions", async () => {
        await expect(
          hooks.session.create.before({ userId: "user-1" }, {}),
        ).resolves.toBe(true);
        expect(mockAuthorizeDiscordSession).not.toHaveBeenCalled();
      });
    });

    describe("when DISCORD_GUILD_ID is set", () => {
      beforeEach(() => {
        process.env.DISCORD_GUILD_ID = "100";
        process.env.DISCORD_BOT_TOKEN = "bot-token";
        process.env.DISCORD_ALLOWED_ROLE_IDS = "10";
      });

      it("links a Discord account with an allowed role", async () => {
        mockIsDiscordUserAllowed.mockResolvedValue(true);

        await expect(
          hooks.account.create.before(discordAccount, {}),
        ).resolves.toBe(true);
        expect(mockIsDiscordUserAllowed).toHaveBeenCalledWith(
          expect.objectContaining({ guildId: "100", allowedRoleIds: ["10"] }),
          "42",
        );
        expect(mockDeleteUserIfUnused).not.toHaveBeenCalled();
      });

      it("refuses a Discord account without an allowed role and drops the new user", async () => {
        mockIsDiscordUserAllowed.mockResolvedValue(false);

        await expect(
          hooks.account.create.before(discordAccount, {}),
        ).rejects.toBeInstanceOf(APIError);
        expect(mockDeleteUserIfUnused).toHaveBeenCalledWith(db, "user-1");
      });

      it("ignores accounts from other providers", async () => {
        await expect(
          hooks.account.create.before(
            { ...discordAccount, providerId: "credential" },
            {},
          ),
        ).resolves.toBe(true);
        expect(mockIsDiscordUserAllowed).not.toHaveBeenCalled();
      });

      it.each([true, false])(
        "lets the Discord check decide sessions (%s)",
        async (allowed) => {
          mockAuthorizeDiscordSession.mockResolvedValue(allowed);

          await expect(
            hooks.session.create.before({ userId: "user-1" }, {}),
          ).resolves.toBe(allowed);
          expect(mockAuthorizeDiscordSession).toHaveBeenCalledWith(
            db,
            expect.objectContaining({ guildId: "100" }),
            "user-1",
          );
        },
      );
    });
  });
});
