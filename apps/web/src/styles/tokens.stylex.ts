import * as stylex from "@stylexjs/stylex";

// Arc's tokens (apps/desktop/src/renderer/src/styles/tokens.stylex.ts). They follow the system's theme, dark unless it
// asks for light; the top bar's toggle forces one with `lightTheme` or `darkTheme` on the root (script.ts).
const LIGHT = "@media (prefers-color-scheme: light)";
const DARK_BASE = "oklch(0.955 0 0)";
const LIGHT_BASE = "oklch(0.21 0 0)";
const mix = (base: string, percent: number): string =>
  `color-mix(in srgb, ${base} ${percent}%, transparent)`;

const DARK = {
  chrome: "oklch(0.191 0 0)",
  frosted: "oklch(0.205 0 0)",
  // The landing page's ground, and the pills on it (top bar, waitlist field) a step above it.
  page: "oklch(0.13 0 0)",
  surface: "oklch(0.17 0 0)",
  textPrimary: DARK_BASE,
  textSecondary: mix(DARK_BASE, 74),
  textTertiary: mix(DARK_BASE, 60),
  bgTertiary: mix(DARK_BASE, 9),
  bgQuaternary: mix(DARK_BASE, 5),
  iconTertiary: mix(DARK_BASE, 52),
  strokeTertiary: mix(DARK_BASE, 8),
  strokeFocused: mix(DARK_BASE, 15),
  accent: "#78aee7",
  accentFill: "#1f252c",
  statusClosed: "oklch(0.713 0.094 155.438)",
  urgent: "oklch(0.712 0.177 12.651)",
  avatarRing: "transparent",
  systemBlue: "#0a84ff",
  windowShadow: "0 40px 100px -20px rgb(0 0 0 / 60%)",
  // The page's ground: NASA's sunrise from orbit, dithered (scripts/field.ts), on a dark or a light page.
  field: 'url("/field-dark.webp")',
  // How much of the page's colour veils the field behind the text (Landing.tsx): the dark page needs more, the light
  // page's field is faint enough to show through.
  veil: "78%",
  // The toggle shows what it switches to: a sun in the dark, a moon in the light.
  showSun: "flex",
  showMoon: "none",
};

const LIGHT_VALUES = {
  chrome: "oklch(0.985 0 0)",
  frosted: "oklch(1 0 0)",
  page: "oklch(0.995 0 0)",
  surface: "oklch(1 0 0)",
  textPrimary: LIGHT_BASE,
  textSecondary: mix(LIGHT_BASE, 72),
  textTertiary: mix(LIGHT_BASE, 55),
  bgTertiary: mix(LIGHT_BASE, 8),
  bgQuaternary: mix(LIGHT_BASE, 4),
  iconTertiary: mix(LIGHT_BASE, 50),
  strokeTertiary: mix(LIGHT_BASE, 10),
  strokeFocused: mix(LIGHT_BASE, 20),
  accent: "#2f6fb7",
  accentFill: "#e2ecf7",
  statusClosed: "oklch(0.55 0.11 155.438)",
  urgent: "oklch(0.58 0.2 12.651)",
  avatarRing: "rgb(0 0 0 / 14%)",
  systemBlue: "#007aff",
  windowShadow: "0 40px 100px -20px rgb(0 0 0 / 18%)",
  field: 'url("/field-light.webp")',
  veil: "66%",
  showSun: "none",
  showMoon: "flex",
};

export const colors = stylex.defineVars({
  chrome: { default: DARK.chrome, [LIGHT]: LIGHT_VALUES.chrome },
  frosted: { default: DARK.frosted, [LIGHT]: LIGHT_VALUES.frosted },
  page: { default: DARK.page, [LIGHT]: LIGHT_VALUES.page },
  surface: { default: DARK.surface, [LIGHT]: LIGHT_VALUES.surface },
  textPrimary: { default: DARK.textPrimary, [LIGHT]: LIGHT_VALUES.textPrimary },
  textSecondary: { default: DARK.textSecondary, [LIGHT]: LIGHT_VALUES.textSecondary },
  textTertiary: { default: DARK.textTertiary, [LIGHT]: LIGHT_VALUES.textTertiary },
  bgTertiary: { default: DARK.bgTertiary, [LIGHT]: LIGHT_VALUES.bgTertiary },
  bgQuaternary: { default: DARK.bgQuaternary, [LIGHT]: LIGHT_VALUES.bgQuaternary },
  iconTertiary: { default: DARK.iconTertiary, [LIGHT]: LIGHT_VALUES.iconTertiary },
  strokeTertiary: { default: DARK.strokeTertiary, [LIGHT]: LIGHT_VALUES.strokeTertiary },
  strokeFocused: { default: DARK.strokeFocused, [LIGHT]: LIGHT_VALUES.strokeFocused },
  accent: { default: DARK.accent, [LIGHT]: LIGHT_VALUES.accent },
  accentFill: { default: DARK.accentFill, [LIGHT]: LIGHT_VALUES.accentFill },
  statusClosed: { default: DARK.statusClosed, [LIGHT]: LIGHT_VALUES.statusClosed },
  urgent: { default: DARK.urgent, [LIGHT]: LIGHT_VALUES.urgent },
  avatarRing: { default: DARK.avatarRing, [LIGHT]: LIGHT_VALUES.avatarRing },
  // Mail's unread dot.
  systemBlue: { default: DARK.systemBlue, [LIGHT]: LIGHT_VALUES.systemBlue },
  windowShadow: { default: DARK.windowShadow, [LIGHT]: LIGHT_VALUES.windowShadow },
  field: { default: DARK.field, [LIGHT]: LIGHT_VALUES.field },
  veil: { default: DARK.veil, [LIGHT]: LIGHT_VALUES.veil },
  showSun: { default: DARK.showSun, [LIGHT]: LIGHT_VALUES.showSun },
  showMoon: { default: DARK.showMoon, [LIGHT]: LIGHT_VALUES.showMoon },
});

// A theme chosen with the toggle, whatever the system's.
export const darkTheme = stylex.createTheme(colors, DARK);
export const lightTheme = stylex.createTheme(colors, LIGHT_VALUES);

export const radii = stylex.defineConsts({
  control: "6px",
  row: "10px",
  panel: "14px",
  pill: "999px",
});

export const fontSizes = stylex.defineConsts({
  small: "11px",
  body: "12px",
  name: "13px",
  message: "15px",
});

export const motion = stylex.defineConsts({
  reduced: "@media (prefers-reduced-motion: reduce)",
});
