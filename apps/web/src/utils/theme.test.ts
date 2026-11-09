import { describe, expect, it } from "vitest";

import {
  buildThemeCss,
  contrastRatio,
  deriveScale,
  parseHexColour,
  parseThemeConfig,
} from "./theme";

describe("parseHexColour", () => {
  it("parses short and long hex colours", () => {
    expect(parseHexColour("#38bdf8")).toEqual([56, 189, 248]);
    expect(parseHexColour("#38BDF8")).toEqual([56, 189, 248]);
    expect(parseHexColour("#bbb")).toEqual([187, 187, 187]);
  });

  it("rejects anything that is not a plain hex colour", () => {
    for (const value of [
      "38bdf8",
      "#38bdf",
      "#38bdf880",
      "red",
      "rgb(1, 2, 3)",
      "#fff;}body{display:none",
      " #ffffff",
      123,
      null,
    ]) {
      expect(parseHexColour(value)).toBeNull();
    }
  });
});

describe("deriveScale", () => {
  it("keeps the base colour as the 600 shade", () => {
    const scale = deriveScale([56, 189, 248]);
    expect(scale["600"]).toEqual([56, 189, 248]);
    expect(Object.keys(scale)).toHaveLength(11);
  });

  it("gets lighter below 600 and darker above", () => {
    const scale = deriveScale([100, 100, 100]);
    expect(scale["100"][0]).toBeGreaterThan(scale["500"][0]);
    expect(scale["500"][0]).toBeGreaterThan(100);
    expect(scale["700"][0]).toBeLessThan(100);
    expect(scale["950"][0]).toBeLessThan(scale["700"][0]);
  });
});

describe("parseThemeConfig", () => {
  it("treats an empty value as the default theme", () => {
    expect(parseThemeConfig(undefined)).toEqual({ ok: true, theme: null });
    expect(parseThemeConfig("")).toEqual({ ok: true, theme: null });
    expect(parseThemeConfig("   ")).toEqual({ ok: true, theme: null });
  });

  it("derives the accent scale and lets links follow it", () => {
    const result = parseThemeConfig('{"accent":"#38bdf8"}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme?.accent?.["600"]).toEqual([56, 189, 248]);
    expect(result.theme?.accent?.["100"]).toBeDefined();
    expect(result.theme?.link).toEqual(result.theme?.accent);
    expect(result.theme?.primaryButton).toBe("default");
  });

  it("keeps links on their own scale when given", () => {
    const result = parseThemeConfig(
      '{"accent":"#38bdf8","link":{"300":"#aaaaaa"}}',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme?.link).toEqual({ "300": [170, 170, 170] });
  });

  it("fills missing accent shades from an explicit 600 shade", () => {
    const result = parseThemeConfig(
      '{"accent":{"600":"#38bdf8","100":"#000000"}}',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme?.accent?.["100"]).toEqual([0, 0, 0]);
    expect(result.theme?.accent?.["700"]).toEqual(
      deriveScale([56, 189, 248])["700"],
    );
  });

  it("accepts partial neutral scales", () => {
    const result = parseThemeConfig(
      '{"dark":{"50":"#0f172a","1000":"#ffffff"},"light":{"50":"#fff"}}',
    );
    expect(result).toEqual({
      ok: true,
      theme: {
        primaryButton: "default",
        dark: { "50": [15, 23, 42], "1000": [255, 255, 255] },
        light: { "50": [255, 255, 255] },
      },
    });
  });

  it("rejects invalid JSON and non objects", () => {
    expect(parseThemeConfig("{accent: '#fff'}").ok).toBe(false);
    expect(parseThemeConfig('"#ffffff"').ok).toBe(false);
    expect(parseThemeConfig("[]").ok).toBe(false);
    expect(parseThemeConfig("null").ok).toBe(false);
  });

  it("rejects unknown keys, unknown shades and non hex values", () => {
    const result = parseThemeConfig(
      JSON.stringify({
        background: "#000000",
        dark: { "25": "#000000", "50": "red" },
        accent: "#fff}body{display:none}",
        light: "#ffffff",
        primaryButton: "outline",
        primaryButtonText: "white",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      '"background" is not a known theme key',
      '"accent" must be a hex colour like #1a2b3c',
      '"dark.25" is not a known shade',
      '"dark.50" must be a hex colour like #1a2b3c',
      '"light" must be an object of shades, e.g. {"50": "#111"}',
      '"primaryButton" must be "default" or "accent"',
      '"primaryButtonText" must be a hex colour like #ffffff',
    ]);
  });

  it("rejects a 1000 shade on accent scales", () => {
    expect(parseThemeConfig('{"accent":{"1000":"#ffffff"}}').ok).toBe(false);
  });

  it("rejects oversized values", () => {
    const huge = JSON.stringify({ accent: "#ffffff", pad: "x".repeat(20_000) });
    const result = parseThemeConfig(huge);
    expect(result.ok).toBe(false);
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21);
    expect(contrastRatio([10, 10, 10], [10, 10, 10])).toBeCloseTo(1);
  });
});

describe("buildThemeCss", () => {
  it("only holds a comment without configuration", () => {
    expect(buildThemeCss(null)).toBe("/* Kan runtime theme */\n\n");
  });

  it("writes overridden variables as RGB channels on html:root", () => {
    const result = parseThemeConfig('{"dark":{"50":"#0f172a"}}');
    if (!result.ok) throw new Error("theme should be valid");
    const css = buildThemeCss(result.theme);
    expect(css).toContain("html:root {\n  --kan-dark-50: 15 23 42;\n}");
    expect(css).not.toContain("--kan-accent");
    expect(css).not.toContain("--kan-button");
  });

  it("paints primary buttons with the accent and readable text", () => {
    const light = parseThemeConfig(
      '{"accent":"#38bdf8","primaryButton":"accent"}',
    );
    const dark = parseThemeConfig(
      '{"accent":"#1e1b4b","primaryButton":"accent"}',
    );
    if (!light.ok || !dark.ok) throw new Error("themes should be valid");

    const lightCss = buildThemeCss(light.theme);
    expect(lightCss).toContain(
      "--kan-button-primary-dark: var(--kan-accent-600);",
    );
    // A light accent gets the dark text colour (default dark-50).
    expect(lightCss).toContain("--kan-button-primary-dark-text: 22 22 22;");

    const darkCss = buildThemeCss(dark.theme);
    expect(darkCss).toContain("--kan-button-primary-light-text: 255 255 255;");
  });

  it("uses the explicit primary button text colour", () => {
    const result = parseThemeConfig(
      '{"accent":"#38bdf8","primaryButton":"accent","primaryButtonText":"#ff0000"}',
    );
    if (!result.ok) throw new Error("theme should be valid");
    expect(buildThemeCss(result.theme)).toContain(
      "--kan-button-primary-light-text: 255 0 0;",
    );
  });

  it("hides the prerendered default brand when branding is configured", () => {
    expect(buildThemeCss(null, { hideDefaultBrand: true })).toContain(
      '[data-kan-brand="default"] {\n  visibility: hidden;\n}',
    );
    expect(buildThemeCss(null)).not.toContain("data-kan-brand");
  });
});
