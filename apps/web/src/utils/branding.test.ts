import { describe, expect, it } from "vitest";

import {
  brandTitle,
  DEFAULT_BRANDING,
  parseBranding,
  sanitizeAppName,
  sanitizeAssetUrl,
} from "./branding";

describe("sanitizeAppName", () => {
  it("trims the name and ignores empty values", () => {
    expect(sanitizeAppName("  Acme Boards ")).toBe("Acme Boards");
    expect(sanitizeAppName("")).toBeNull();
    expect(sanitizeAppName("   ")).toBeNull();
    expect(sanitizeAppName(undefined)).toBeNull();
  });

  it("rejects overlong names and control characters", () => {
    expect(sanitizeAppName("a".repeat(65))).toBeNull();
    expect(sanitizeAppName("Acme\nBoards")).toBeNull();
  });
});

describe("sanitizeAssetUrl", () => {
  it("accepts http(s) URLs and same origin paths", () => {
    expect(sanitizeAssetUrl("https://example.com/logo.svg")).toBe(
      "https://example.com/logo.svg",
    );
    expect(sanitizeAssetUrl("http://localhost:3000/logo.png")).toBe(
      "http://localhost:3000/logo.png",
    );
    expect(sanitizeAssetUrl("/brand/logo.svg")).toBe("/brand/logo.svg");
  });

  it("rejects other schemes, protocol-relative and relative URLs", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,AAAA",
      "//evil.example/logo.svg",
      "/\\evil.example/logo.svg",
      "logo.svg",
      "https://example.com/\nlogo.svg",
      "",
      undefined,
    ]) {
      expect(sanitizeAssetUrl(value)).toBeNull();
    }
  });
});

describe("parseBranding", () => {
  it("returns the default branding without configuration", () => {
    expect(parseBranding({})).toBe(DEFAULT_BRANDING);
    expect(parseBranding({ appName: "", logoUrl: "javascript:x" })).toBe(
      DEFAULT_BRANDING,
    );
  });

  it("uses the configured name and logo", () => {
    expect(
      parseBranding({ appName: "Acme", logoUrl: "/brand/logo.svg" }),
    ).toEqual({
      appName: "Acme",
      logoUrl: "/brand/logo.svg",
      isDefault: false,
    });
  });

  it("keeps the default name next to a configured logo", () => {
    expect(parseBranding({ logoUrl: "/brand/logo.svg" })).toEqual({
      appName: "kan.bn",
      logoUrl: "/brand/logo.svg",
      isDefault: false,
    });
  });
});

describe("brandTitle", () => {
  it("replaces the stock name in titles", () => {
    const branding = parseBranding({ appName: "Acme" });
    expect(brandTitle("Login | kan.bn", branding)).toBe("Login | Acme");
    expect(brandTitle("Settings | Account", branding)).toBe(
      "Settings | Account",
    );
  });

  it("leaves titles untouched by default", () => {
    expect(brandTitle("Login | kan.bn", DEFAULT_BRANDING)).toBe(
      "Login | kan.bn",
    );
  });
});
