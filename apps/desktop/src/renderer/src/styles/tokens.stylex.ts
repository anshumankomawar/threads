import * as stylex from "@stylexjs/stylex";

// Dark is the default; `lightTheme` (on the root, from `applyTheme`) is the same tokens for light.
const DARK_BASE = "oklch(0.955 0 0)";
const LIGHT_BASE = "oklch(0.21 0 0)";
const mix = (base: string, percent: number): string =>
  `color-mix(in srgb, ${base} ${percent}%, transparent)`;

export const colors = stylex.defineVars({
  chrome: "oklch(0.191 0 0)",
  sidebarSolid: "#1a1a1a",
  textPrimary: DARK_BASE,
  textSecondary: mix(DARK_BASE, 74),
  textTertiary: mix(DARK_BASE, 60),
  bgTertiary: mix(DARK_BASE, 9),
  bgQuaternary: mix(DARK_BASE, 5),
  iconTertiary: mix(DARK_BASE, 52),
  strokeTertiary: mix(DARK_BASE, 8),
  strokeFocused: mix(DARK_BASE, 15),
  panel: "#171717",
  panelBorder: "#212121",
  panelSelected: "#222222",
  accent: "#78aee7",
  accentFill: "#1f252c",
  statusClosed: "oklch(0.713 0.094 155.438)",
  urgent: "oklch(0.712 0.177 12.651)",
  overlay: "rgb(0 0 0 / 45%)",
  avatarRing: "transparent",
});

export const lightTheme = stylex.createTheme(colors, {
  chrome: "oklch(0.985 0 0)",
  sidebarSolid: "#f4f4f3",
  textPrimary: LIGHT_BASE,
  textSecondary: mix(LIGHT_BASE, 72),
  textTertiary: mix(LIGHT_BASE, 55),
  bgTertiary: mix(LIGHT_BASE, 8),
  bgQuaternary: mix(LIGHT_BASE, 4),
  iconTertiary: mix(LIGHT_BASE, 50),
  strokeTertiary: mix(LIGHT_BASE, 10),
  strokeFocused: mix(LIGHT_BASE, 20),
  panel: "#ffffff",
  panelBorder: "#e4e4e2",
  panelSelected: "#efefed",
  accent: "#2f6fb7",
  accentFill: "#e2ecf7",
  statusClosed: "oklch(0.55 0.11 155.438)",
  urgent: "oklch(0.58 0.2 12.651)",
  overlay: "rgb(0 0 0 / 18%)",
  avatarRing: "rgb(0 0 0 / 14%)",
});

export const sidebarSpace = stylex.defineConsts({
  inset: "12px",
  rowGutter: "6px",
  rowRadius: "6px",
});

// The main content's zoom (⌘+, ⌘-, ⌘0), set on the root by the store.
export const contentZoom = stylex.defineVars({
  "--content-zoom": "1",
});

export const layers = stylex.defineConsts({
  titlebar: 10,
  overlay: 20,
  caretMenu: 50,
  contextMenu: 60,
});

export const radii = stylex.defineConsts({
  control: "4px",
  button: "5px",
  item: "6px",
  panel: "8px",
});

export const fontSizes = stylex.defineConsts({
  label: "10px",
  small: "11px",
  body: "12px",
  name: "13px",
  input: "14px",
  message: "15px",
  pageTitle: "20px",
});

export const shadows = stylex.defineConsts({
  panel: "0 4px 12px rgb(0 0 0 / 28%)",
  float: "0 8px 24px rgb(0 0 0 / 35%)",
});
