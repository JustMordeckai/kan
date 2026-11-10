import { describe, expect, it, vi } from "vitest";

import {
  DiscordApiError,
  fetchGuildMemberRoleIds,
  fetchGuildRoles,
} from "./client";

const config = { guildId: "100", botToken: "bot-token" };

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const setup = (...responses: (Response | Error)[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response);
    else fetch.mockResolvedValueOnce(response);
  }
  const sleep = vi.fn((_ms: number) => Promise.resolve());
  return { fetch, sleep };
};

describe("fetchGuildMemberRoleIds", () => {
  it("returns the member's role ids", async () => {
    const options = setup(jsonResponse(200, { roles: ["1", "2"] }));

    await expect(
      fetchGuildMemberRoleIds(config, "42", options),
    ).resolves.toEqual(["1", "2"]);

    const [url, init] = options.fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://discord.com/api/v10/guilds/100/members/42");
    expect(init?.headers).toEqual({ Authorization: "Bot bot-token" });
  });

  it("returns null when the user is not in the guild", async () => {
    const options = setup(
      jsonResponse(404, { message: "Unknown Member", code: 10007 }),
    );

    await expect(
      fetchGuildMemberRoleIds(config, "42", options),
    ).resolves.toBeNull();
  });

  it("throws on a 404 that is not about the member (unknown guild)", async () => {
    const options = setup(
      jsonResponse(404, { message: "Unknown Guild", code: 10004 }),
    );

    await expect(
      fetchGuildMemberRoleIds(config, "42", options),
    ).rejects.toBeInstanceOf(DiscordApiError);
  });

  it("waits retry_after and retries when rate limited", async () => {
    const options = setup(
      jsonResponse(429, { retry_after: 1.5, global: false }),
      jsonResponse(200, { roles: ["1"] }),
    );

    await expect(
      fetchGuildMemberRoleIds(config, "42", options),
    ).resolves.toEqual(["1"]);
    expect(options.sleep).toHaveBeenCalledWith(1500);
    expect(options.fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the maximum number of retries", async () => {
    const options = setup(
      jsonResponse(429, { retry_after: 0.1 }),
      jsonResponse(429, { retry_after: 0.1 }),
    );

    await expect(
      fetchGuildMemberRoleIds(config, "42", { ...options, maxRetries: 1 }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("waits for the bucket reset when no request is left", async () => {
    const options = setup(
      jsonResponse(
        200,
        { roles: [] },
        { "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "2" },
      ),
    );

    await fetchGuildMemberRoleIds(config, "42", options);
    expect(options.sleep).toHaveBeenCalledWith(2000);
  });

  it("throws on server errors", async () => {
    const options = setup(jsonResponse(503, { message: "unavailable" }));

    await expect(
      fetchGuildMemberRoleIds(config, "42", options),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("throws when Discord cannot be reached", async () => {
    const options = setup(new TypeError("fetch failed"));

    await expect(
      fetchGuildMemberRoleIds(config, "42", options),
    ).rejects.toBeInstanceOf(DiscordApiError);
  });

  it("refuses to call Discord without a bot token or with a bad id", async () => {
    const options = setup();

    await expect(
      fetchGuildMemberRoleIds({ ...config, botToken: "" }, "42", options),
    ).rejects.toBeInstanceOf(DiscordApiError);
    await expect(
      fetchGuildMemberRoleIds(config, "../42", options),
    ).rejects.toBeInstanceOf(DiscordApiError);
    expect(options.fetch).not.toHaveBeenCalled();
  });
});

describe("fetchGuildRoles", () => {
  it("returns the guild roles with their name, colour and position", async () => {
    const options = setup(
      jsonResponse(200, [
        { id: "100", name: "@everyone", color: 0, position: 0 },
        { id: "200", name: "Staff", color: 15158332, position: 5 },
        { id: "300", name: "Dev" },
      ]),
    );

    await expect(fetchGuildRoles(config, options)).resolves.toEqual([
      { id: "100", name: "@everyone", colour: 0, position: 0 },
      { id: "200", name: "Staff", colour: 15158332, position: 5 },
      { id: "300", name: "Dev", colour: 0, position: 0 },
    ]);

    const [url, init] = options.fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://discord.com/api/v10/guilds/100/roles");
    expect(init?.headers).toEqual({ Authorization: "Bot bot-token" });
  });

  it("skips malformed roles", async () => {
    const options = setup(
      jsonResponse(200, [
        { id: "abc", name: "Bad id" },
        { id: "200" },
        null,
        { id: "300", name: "Ok", color: 1.5 },
      ]),
    );

    await expect(fetchGuildRoles(config, options)).resolves.toEqual([
      { id: "300", name: "Ok", colour: 0, position: 0 },
    ]);
  });

  it("retries when rate limited", async () => {
    const options = setup(
      jsonResponse(429, { retry_after: 0.5 }),
      jsonResponse(200, []),
    );

    await expect(fetchGuildRoles(config, options)).resolves.toEqual([]);
    expect(options.sleep).toHaveBeenCalledWith(500);
  });

  it("throws on an error response or an unexpected payload", async () => {
    await expect(
      fetchGuildRoles(config, setup(jsonResponse(403, { code: 50001 }))),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      fetchGuildRoles(config, setup(jsonResponse(200, { roles: [] }))),
    ).rejects.toBeInstanceOf(DiscordApiError);
  });

  it("refuses to call Discord without a bot token or with a bad guild id", async () => {
    const options = setup();

    await expect(
      fetchGuildRoles({ ...config, botToken: "" }, options),
    ).rejects.toBeInstanceOf(DiscordApiError);
    await expect(
      fetchGuildRoles({ ...config, guildId: "x" }, options),
    ).rejects.toBeInstanceOf(DiscordApiError);
    expect(options.fetch).not.toHaveBeenCalled();
  });
});
