/**
 * Runtime colour theme for self-hosted instances.
 *
 * Kan's palette is exposed as CSS variables holding space separated RGB
 * channels (see `styles/globals.css` and `tooling/tailwind/web.ts`). An
 * instance can override them without rebuilding through the
 * `NEXT_PUBLIC_THEME` environment variable, a JSON object such as:
 *
 *   {
 *     "accent": "#0d9488",
 *     "link": { "300": "#5eead4", "600": "#0d9488" },
 *     "dark": { "50": "#0f172a", "100": "#111827" },
 *     "light": { "50": "#ffffff" },
 *     "primaryButton": "accent"
 *   }
 *
 * Every key and value is validated strictly: only known keys and hex colours
 * are accepted, so nothing from the environment reaches the stylesheet
 * verbatim. An invalid configuration is ignored as a whole and the default
 * look is kept.
 */

export const NEUTRAL_SCALE_KEYS = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
  "1000",
] as const;

export const ACCENT_SCALE_KEYS = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const;

export type NeutralScaleKey = (typeof NEUTRAL_SCALE_KEYS)[number];
export type AccentScaleKey = (typeof ACCENT_SCALE_KEYS)[number];
export type Rgb = readonly [number, number, number];

type NeutralScale = Partial<Record<NeutralScaleKey, Rgb>>;
type AccentScale = Partial<Record<AccentScaleKey, Rgb>>;

export interface ThemeTokens {
  accent?: AccentScale;
  link?: AccentScale;
  dark?: NeutralScale;
  light?: NeutralScale;
  primaryButton: "default" | "accent";
  primaryButtonText?: Rgb;
}

export type ThemeParseResult =
  | { ok: true; theme: ThemeTokens | null }
  | { ok: false; errors: string[] };

const MAX_THEME_LENGTH = 10_000;
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const THEME_KEYS = [
  "accent",
  "link",
  "dark",
  "light",
  "primaryButton",
  "primaryButtonText",
] as const;

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
// Default value of dark-50, the text colour of the dark mode primary button.
const DEFAULT_DARK_TEXT: Rgb = [22, 22, 22];

// How much white (lighter shades) or black (darker shades) is mixed into the
// "600" colour to derive a full scale from a single colour.
const SCALE_MIX: Record<AccentScaleKey, { towards: Rgb; amount: number }> = {
  "50": { towards: WHITE, amount: 0.95 },
  "100": { towards: WHITE, amount: 0.9 },
  "200": { towards: WHITE, amount: 0.75 },
  "300": { towards: WHITE, amount: 0.6 },
  "400": { towards: WHITE, amount: 0.4 },
  "500": { towards: WHITE, amount: 0.2 },
  "600": { towards: WHITE, amount: 0 },
  "700": { towards: BLACK, amount: 0.15 },
  "800": { towards: BLACK, amount: 0.3 },
  "900": { towards: BLACK, amount: 0.45 },
  "950": { towards: BLACK, amount: 0.6 },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses `#rgb` or `#rrggbb`. Anything else returns null. */
export function parseHexColour(value: unknown): Rgb | null {
  if (typeof value !== "string" || !HEX_COLOUR.test(value)) return null;

  let hex = value.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((digit) => digit + digit)
      .join("");
  }

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * amount),
  Math.round(from[1] + (to[1] - from[1]) * amount),
  Math.round(from[2] + (to[2] - from[2]) * amount),
];

/** Derives a full 50-950 scale where `base` is the 600 shade. */
export function deriveScale(base: Rgb): Record<AccentScaleKey, Rgb> {
  const scale = {} as Record<AccentScaleKey, Rgb>;
  for (const key of ACCENT_SCALE_KEYS) {
    const { towards, amount } = SCALE_MIX[key];
    scale[key] = mix(base, towards, amount);
  }
  return scale;
}

// WCAG 2 relative luminance.
const luminance = (colour: Rgb) => {
  const [r, g, b] = colour.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (a: Rgb, b: Rgb) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

/** Picks whichever of `light` or `dark` text reads best on `background`. */
export const readableTextOn = (background: Rgb, light: Rgb, dark: Rgb) =>
  contrastRatio(background, light) >= contrastRatio(background, dark)
    ? light
    : dark;

function parseNeutralScale(
  name: string,
  value: unknown,
  errors: string[],
): NeutralScale | undefined {
  if (!isRecord(value)) {
    errors.push(`"${name}" must be an object of shades, e.g. {"50": "#111"}`);
    return undefined;
  }

  const scale: NeutralScale = {};
  for (const [key, colour] of Object.entries(value)) {
    if (!(NEUTRAL_SCALE_KEYS as readonly string[]).includes(key)) {
      errors.push(`"${name}.${key}" is not a known shade`);
      continue;
    }
    const rgb = parseHexColour(colour);
    if (!rgb) {
      errors.push(`"${name}.${key}" must be a hex colour like #1a2b3c`);
      continue;
    }
    scale[key as NeutralScaleKey] = rgb;
  }
  return scale;
}

function parseAccentScale(
  name: string,
  value: unknown,
  errors: string[],
): AccentScale | undefined {
  if (typeof value === "string") {
    const rgb = parseHexColour(value);
    if (!rgb) {
      errors.push(`"${name}" must be a hex colour like #1a2b3c`);
      return undefined;
    }
    return deriveScale(rgb);
  }

  if (!isRecord(value)) {
    errors.push(`"${name}" must be a hex colour or an object of shades`);
    return undefined;
  }

  const explicit: AccentScale = {};
  for (const [key, colour] of Object.entries(value)) {
    if (!(ACCENT_SCALE_KEYS as readonly string[]).includes(key)) {
      errors.push(`"${name}.${key}" is not a known shade`);
      continue;
    }
    const rgb = parseHexColour(colour);
    if (!rgb) {
      errors.push(`"${name}.${key}" must be a hex colour like #1a2b3c`);
      continue;
    }
    explicit[key as AccentScaleKey] = rgb;
  }

  // Shades left out are derived from the 600 shade when it is given,
  // otherwise they keep their default value.
  const base = explicit["600"];
  return base ? { ...deriveScale(base), ...explicit } : explicit;
}

/**
 * Parses and validates the `NEXT_PUBLIC_THEME` value. An empty value is not
 * an error and means "default theme" (`theme: null`).
 */
export function parseThemeConfig(raw: string | undefined): ThemeParseResult {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, theme: null };

  if (trimmed.length > MAX_THEME_LENGTH) {
    return {
      ok: false,
      errors: [`theme is longer than ${MAX_THEME_LENGTH} characters`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, errors: ["theme is not valid JSON"] };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ["theme must be a JSON object"] };
  }

  const errors: string[] = [];
  const theme: ThemeTokens = { primaryButton: "default" };

  for (const key of Object.keys(parsed)) {
    if (!(THEME_KEYS as readonly string[]).includes(key)) {
      errors.push(`"${key}" is not a known theme key`);
    }
  }

  if (parsed.accent !== undefined) {
    theme.accent = parseAccentScale("accent", parsed.accent, errors);
  }
  if (parsed.link !== undefined) {
    theme.link = parseAccentScale("link", parsed.link, errors);
  } else if (theme.accent) {
    // Links follow the accent unless they are themed on their own.
    theme.link = theme.accent;
  }
  if (parsed.dark !== undefined) {
    theme.dark = parseNeutralScale("dark", parsed.dark, errors);
  }
  if (parsed.light !== undefined) {
    theme.light = parseNeutralScale("light", parsed.light, errors);
  }

  if (parsed.primaryButton !== undefined) {
    if (
      parsed.primaryButton === "default" ||
      parsed.primaryButton === "accent"
    ) {
      theme.primaryButton = parsed.primaryButton;
    } else {
      errors.push(`"primaryButton" must be "default" or "accent"`);
    }
  }

  if (parsed.primaryButtonText !== undefined) {
    const rgb = parseHexColour(parsed.primaryButtonText);
    if (rgb) theme.primaryButtonText = rgb;
    else errors.push(`"primaryButtonText" must be a hex colour like #ffffff`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, theme };
}

const channels = (rgb: Rgb) => `${rgb[0]} ${rgb[1]} ${rgb[2]}`;

const scaleDeclarations = (
  prefix: string,
  scale: Partial<Record<string, Rgb>>,
) =>
  Object.entries(scale).flatMap(([key, rgb]) =>
    rgb ? [`  --kan-${prefix}-${key}: ${channels(rgb)};`] : [],
  );

const ACCENT_600_FALLBACK: Rgb = [79, 70, 229];

/**
 * Turns validated tokens into CSS. Only values built from parsed numbers and
 * fixed key names end up in the output.
 */
export function buildThemeCss(
  theme: ThemeTokens | null,
  options: { hideDefaultBrand?: boolean } = {},
): string {
  const rules: string[] = [];

  if (theme) {
    const declarations = [
      ...scaleDeclarations("dark", theme.dark ?? {}),
      ...scaleDeclarations("light", theme.light ?? {}),
      ...scaleDeclarations("accent", theme.accent ?? {}),
      ...scaleDeclarations("link", theme.link ?? {}),
    ];

    if (theme.primaryButton === "accent") {
      const accent = theme.accent?.["600"] ?? ACCENT_600_FALLBACK;
      const text =
        theme.primaryButtonText ??
        readableTextOn(accent, WHITE, theme.dark?.["50"] ?? DEFAULT_DARK_TEXT);
      declarations.push(
        "  --kan-button-primary-light: var(--kan-accent-600);",
        `  --kan-button-primary-light-text: ${channels(text)};`,
        "  --kan-button-primary-dark: var(--kan-accent-600);",
        `  --kan-button-primary-dark-text: ${channels(text)};`,
      );
    }

    // `html:root` outranks the `:root` defaults whatever the stylesheet order.
    if (declarations.length) {
      rules.push(`html:root {\n${declarations.join("\n")}\n}`);
    }
  }

  if (options.hideDefaultBrand) {
    // The prerendered HTML carries the default brand until the runtime one is
    // rendered on the client: keep it invisible so it never flashes.
    rules.push(`[data-kan-brand="default"] {\n  visibility: hidden;\n}`);
  }

  return `/* Kan runtime theme */\n${rules.join("\n\n")}\n`;
}
