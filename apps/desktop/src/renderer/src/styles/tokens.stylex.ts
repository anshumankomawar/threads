import * as stylex from "@stylexjs/stylex";

// Dark is the default; `lightTheme` (on the root, from `applyTheme`) is the same tokens for light.
const DARK_BASE = "oklch(0.955 0 0)";
const LIGHT_BASE = "oklch(0.21 0 0)";
const mix = (base: string, percent: number): string =>
  `color-mix(in srgb, ${base} ${percent}%, transparent)`;

const DARK = {
  // The window's ground, opaque, as the macOS app's.
  chrome: "#141414",
  textPrimary: DARK_BASE,
  textSecondary: mix(DARK_BASE, 74),
  textTertiary: mix(DARK_BASE, 60),
  bgTertiary: mix(DARK_BASE, 9),
  bgQuaternary: mix(DARK_BASE, 5),
  iconTertiary: mix(DARK_BASE, 52),
  strokeTertiary: mix(DARK_BASE, 8),
  strokeFocused: mix(DARK_BASE, 15),
  // A column's resize edge while it's hovered or dragged: just stronger than the border it's on.
  resizeEdge: mix(DARK_BASE, 11),
  panel: "#171717",
  panelBorder: "#212121",
  panelSelected: "#222222",
  // A card on the ground (a timeline's bars): above it in either theme, white in light and lighter in dark.
  raised: "#1e1e1e",
  raisedBorder: "#2a2a2a",
  accent: "#78aee7",
  accentFill: "#1f252c",
  // Solid buttons (a table view's New): Notion's blue, in both themes.
  primary: "rgb(35 131 226)",
  primaryHover: "rgb(28 112 196)",
  statusClosed: "oklch(0.713 0.094 155.438)",
  urgent: "oklch(0.712 0.177 12.651)",
  avatarRing: "transparent",
  // Mail's unread dot.
  systemBlue: "#0a84ff",
  // A high priority's mark: the system's orange.
  priority: "#ff9f0a",
  // Shadows under floating panels (menus, palettes) and floating bars (toasts, a draft's bar): deep on dark, where a
  // shadow has little to show against, and light on light.
  shadowPanel: "0 4px 12px rgb(0 0 0 / 28%)",
  shadowFloat: "0 8px 24px rgb(0 0 0 / 35%)",
};
export const colors = stylex.defineVars(DARK);
// Every token at its dark value, for one panel in the light theme (`inverted`).
export const darkTheme = stylex.createTheme(colors, DARK);

export const lightTheme = stylex.createTheme(colors, {
  chrome: "#fafafa",
  textPrimary: LIGHT_BASE,
  textSecondary: mix(LIGHT_BASE, 72),
  textTertiary: mix(LIGHT_BASE, 55),
  // Light washes for hover and selection: on a light ground the same tint reads much darker than in dark mode.
  bgTertiary: mix(LIGHT_BASE, 5.5),
  bgQuaternary: mix(LIGHT_BASE, 3),
  iconTertiary: mix(LIGHT_BASE, 50),
  strokeTertiary: mix(LIGHT_BASE, 10),
  strokeFocused: mix(LIGHT_BASE, 20),
  resizeEdge: mix(LIGHT_BASE, 12),
  panel: "#ffffff",
  panelBorder: "#e4e4e2",
  panelSelected: "#f3f3f1",
  raised: "#ffffff",
  raisedBorder: "#dcdcd9",
  accent: "#2f6fb7",
  accentFill: "#e2ecf7",
  primary: "rgb(35 131 226)",
  primaryHover: "rgb(28 112 196)",
  statusClosed: "oklch(0.55 0.11 155.438)",
  urgent: "oklch(0.58 0.2 12.651)",
  avatarRing: "rgb(0 0 0 / 14%)",
  systemBlue: "#007aff",
  priority: "#ff9500",
  shadowPanel: "0 2px 8px rgb(0 0 0 / 8%)",
  shadowFloat: "0 4px 14px rgb(0 0 0 / 9%)",
});

// Slack's look: an aubergine sidebar in white type, its chosen row blue, over the light theme (`slackSidebar` on the
// sidebar, `lightTheme` on the root; `applyTheme`'s "slack").
const AUBERGINE = "#3f0e40";
const ON_AUBERGINE = "#ffffff";
export const slackSidebar = stylex.createTheme(colors, {
  ...DARK,
  chrome: AUBERGINE,
  textPrimary: ON_AUBERGINE,
  textSecondary: mix(ON_AUBERGINE, 82),
  textTertiary: mix(ON_AUBERGINE, 70),
  bgTertiary: "#1164a3",
  bgQuaternary: "#350d36",
  iconTertiary: mix(ON_AUBERGINE, 72),
  strokeTertiary: "#522653",
  strokeFocused: mix(ON_AUBERGINE, 25),
  resizeEdge: mix(ON_AUBERGINE, 20),
});

export const sidebarSpace = stylex.defineConsts({
  // Where the top bar's first button starts, beside the traffic lights: its centre lands where a fourth light would
  // (theirs are 23pt apart, the first's centre 18.75pt in), so it's 9pt from the last, as they are from each other.
  // (12 + 3 × 23 + 6.75)pt ÷ 1.1, less half the 22px button. In CSS pixels at the 110% scale.
  afterLights: "69px",
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

// Small things in text and menus (chips, links, menu items, fields) · every row and button that fills on hover ·
// floating panels.
export const radii = stylex.defineConsts({
  control: "6px",
  // A sidebar row and your profile under them (8pt).
  item: "7.27px",
  row: "10px",
  panel: "14px",
  // A capsule: chips and fields whose ends are fully round, whatever their height.
  pill: "999px",
});

// The macOS app's text sizes (SF Pro, the system font, in both): each its points ÷ 1.1, for the renderer's 110% scale.
export const fontSizes = stylex.defineConsts({
  label: "9.09px", // 10pt
  small: "10px", // 11pt
  caption: "10.91px", // 12pt, a section's or group's heading
  body: "11.82px", // 13pt, the body
  name: "12.73px", // 14pt, a row's title
  input: "12.73px", // 14pt
  message: "14.55px", // 16pt, a message
  pageTitle: "18.18px", // 20pt, a title
});

// The sidebar's and the list's one step (8pt): rows in from their ends, an icon from its name, a column from its edge.
export const space = stylex.defineConsts({
  inset: "7.27px",
});

// Animations stop for anyone who asks the system for less motion.
export const motion = stylex.defineConsts({
  reduced: "@media (prefers-reduced-motion: reduce)",
  // macOS's spring-like settle, for things that move into place (folds, the layout pill).
  settle: "cubic-bezier(0.32, 0.72, 0, 1)",
});
