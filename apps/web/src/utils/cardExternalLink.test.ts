import { describe, expect, it } from "vitest";

import {
  getCardExternalUrlError,
  parseCardExternalLink,
} from "./cardExternalLink";

describe("parseCardExternalLink", () => {
  it.each([
    "https://discord.com/channels/1/2",
    "https://www.discord.com/channels/1/2",
    "https://ptb.discord.com/channels/1/2",
    "https://canary.discord.com/channels/1/2",
    "https://discordapp.com/channels/1/2",
    "https://ptb.discordapp.com/channels/1/2",
    "https://canary.discordapp.com/channels/1/2",
    "https://DISCORD.com/channels/1/2",
  ])("recognises %s as a Discord link", (url) => {
    expect(parseCardExternalLink(url)?.isDiscord).toBe(true);
  });

  it.each([
    "https://example.com/discord.com",
    "https://discord.com.example.com/channels/1/2",
    "https://notdiscord.com/channels/1/2",
    "https://discord.gg/abc",
  ])("does not treat %s as a Discord link", (url) => {
    expect(parseCardExternalLink(url)?.isDiscord).toBe(false);
  });

  it("returns the hostname without www for other links", () => {
    expect(
      parseCardExternalLink("https://www.example.com/tickets/42?x=1"),
    ).toEqual({
      url: "https://www.example.com/tickets/42?x=1",
      hostname: "example.com",
      isDiscord: false,
    });
  });

  it.each([
    null,
    undefined,
    "",
    "http://example.com",
    "javascript:alert(1)",
    "not a link",
  ])("returns null for %s", (value) => {
    expect(parseCardExternalLink(value)).toBeNull();
  });
});

describe("getCardExternalUrlError", () => {
  it("accepts an https link, spaces around it included", () => {
    expect(getCardExternalUrlError(" https://discord.com/channels/1/2 ")).toBe(
      null,
    );
  });

  it("rejects links that are not https", () => {
    expect(getCardExternalUrlError("http://example.com")).toBe("notHttps");
    expect(getCardExternalUrlError("javascript:alert(1)")).toBe("notHttps");
  });

  it("rejects text that is not a link", () => {
    expect(getCardExternalUrlError("example.com")).toBe("invalid");
  });

  it("rejects links over 2048 characters", () => {
    const base = "https://example.com/";
    expect(getCardExternalUrlError(base + "a".repeat(2048 - base.length))).toBe(
      null,
    );
    expect(getCardExternalUrlError(base + "a".repeat(2049 - base.length))).toBe(
      "tooLong",
    );
  });
});
