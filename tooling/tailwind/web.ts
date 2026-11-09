import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";
import scrollbar from "tailwind-scrollbar";

const neutralShades = [
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
];
const accentShades = neutralShades.filter((shade) => shade !== "1000");

const themeColour = (name: string) => `rgb(var(--kan-${name}) / <alpha-value>)`;

// Flat names (dark-50, light-1000) as used across the app.
const themeScale = (name: string, shades: string[]) =>
  Object.fromEntries(
    shades.map((shade) => [
      `${name}-${shade}`,
      themeColour(`${name}-${shade}`),
    ]),
  );

// Nested scale (accent: { 600: ... }) for accent-600 style classes.
const themeShades = (name: string, shades: string[]) =>
  Object.fromEntries(
    shades.map((shade) => [shade, themeColour(`${name}-${shade}`)]),
  );

export default {
  content: ["./src/**/*.tsx"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-plus-jakarta-sans), Plus Jakarta Sans"],
      },
      fontSize: {
        sm: "0.8rem",
      },
      boxShadow: {
        "3xl-dark": "0px 16px 70px rgba(0, 0, 0, 0.5)",
        "3xl-light":
          "rgba(0, 0, 0, 0.12) 0px 4px 30px, rgba(0, 0, 0, 0.04) 0px 3px 17px, rgba(0, 0, 0, 0.04) 0px 2px 8px, rgba(0, 0, 0, 0.04) 0px 1px 1px",
      },
      animation: {
        "border-spin": "border-spin 4s linear infinite",
        "fade-down": "fade-down 0.5s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        scroll: "scroll 40s linear infinite",
      },

      keyframes: {
        "border-spin": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "fade-down": {
          "0%": {
            opacity: "0",
            transform: "translateY(-20px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "fade-in": {
          "0%": {
            opacity: "0",
          },
          "100%": {
            opacity: "1",
          },
        },
        scroll: {
          "0%": {
            transform: "translateX(0)",
          },
          "100%": {
            transform: "translateX(calc(-50% - 1.5rem))",
          },
        },
      },
      // Every colour reads a CSS variable holding RGB channels (defaults in
      // apps/web/src/styles/globals.css), so instances can re-theme Kan at
      // runtime while opacity modifiers like bg-dark-50/90 keep working.
      colors: {
        ...themeScale("dark", neutralShades),
        ...themeScale("light", neutralShades),
        accent: themeShades("accent", accentShades),
        link: themeShades("link", accentShades),
        "button-primary-light": themeColour("button-primary-light"),
        "button-primary-light-text": themeColour("button-primary-light-text"),
        "button-primary-dark": themeColour("button-primary-dark"),
        "button-primary-dark-text": themeColour("button-primary-dark-text"),
      },
      screens: {
        "2xl": "1600px",
      },
    },
  },
  plugins: [forms, scrollbar],
} satisfies Config;
