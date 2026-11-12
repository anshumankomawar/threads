import * as stylex from "@stylexjs/stylex";

// Dark is the default; `lightTheme` (on the root, from `applyTheme`) is the same tokens for light.
const DARK_BASE = "oklch(0.955 0 0)";
const mix = (base: string, percent: number): string =>
  `color-mix(in srgb, ${base} ${percent}%, transparent)`;

const DARK = {
  // The window's ground, opaque, as the macOS app's.
  chrome: "#0c0c0c",
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

// Light is the U.S. Graphics catalog's paper (usgraphics-wds.css): black ink on white sheets over #eee, #bfbfbf rules,
// square black-bordered panels with a soft 30px shadow, #002dce links, and its menu's #9ba3a8 hover.
export const lightTheme = stylex.createTheme(colors, {
  chrome: "#eeeeee",
  textPrimary: "#000000",
  textSecondary: "#333333",
  textTertiary: "#777777",
  // Its `.table tr.active`: a 10% black wash.
  bgTertiary: "rgb(0 0 0 / 10%)",
  bgQuaternary: "rgb(0 0 0 / 5%)",
  iconTertiary: "#555555",
  strokeTertiary: "#bfbfbf",
  strokeFocused: "#000000",
  resizeEdge: "#888888",
  panel: "#ffffff",
  panelBorder: "#000000",
  panelSelected: "#9ba3a8",
  raised: "#ffffff",
  raisedBorder: "#000000",
  accent: "#002dce",
  accentFill: "#c9e5ff",
  primary: "rgb(35 131 226)",
  primaryHover: "rgb(28 112 196)",
  statusClosed: "oklch(0.55 0.11 155.438)",
  urgent: "#e7040f",
  avatarRing: "rgb(0 0 0 / 14%)",
  systemBlue: "#ff4136",
  priority: "#e25600",
  shadowPanel: "0 0 30px rgb(0 0 0 / 25%)",
  shadowFloat: "0 0 30px rgb(0 0 0 / 25%)",
});

// The catalog's own inks (usgraphics-wds.css), in dark first and then its light paper: a sheet, its ink, cell rules
// (#bfbfbf), the hard 2px shadows under sheets (#ccc), buttons (#bbb) and tables (#ddd), a table's 4px left edge
// (#aaa), a sheet's frame (#888), its greys, the nav's red dot (#ff4136), the dark green of ORDER (#006b52), and the
// light tints of its SKU codes.
const CATALOG_DARK = {
  sheet: "#161616",
  ink: "#e8e8e8",
  rule: "#3a3a3a",
  hardSheet: "#000000",
  hardButton: "#000000",
  hardTable: "#000000",
  edge: "#555555",
  frame: "#4a4a4a",
  gray: "#8a8a8a",
  silver: "#6f6f6f",
  link: "#7d9dff",
  red: "#ff4136",
  green: "#00805f",
  yellow: "#4a4520",
  pink: "#4d2a45",
  blue: "#22384e",
  mint: "#1d4a3b",
  chip: "#333333",
};
export const cat = stylex.defineVars(CATALOG_DARK);
export const catalogLight = stylex.createTheme(cat, {
  sheet: "#ffffff",
  ink: "#000000",
  rule: "#bfbfbf",
  hardSheet: "#cccccc",
  hardButton: "#bbbbbb",
  hardTable: "#dddddd",
  edge: "#aaaaaa",
  frame: "#888888",
  gray: "#777777",
  silver: "#999999",
  link: "#002dce",
  red: "#ff4136",
  green: "#006b52",
  yellow: "#fff5b1",
  pink: "#fcd4f2",
  blue: "#c9e5ff",
  mint: "#b9ffe4",
  // .chip's #e6e6e6.
  chip: "#e6e6e6",
});
// Its data face, TX-02 (licensed, so not shipped here): the system's mono in its place.
export const fonts = stylex.defineConsts({
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
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
// The catalog's corners are square, everywhere but its chips.
export const radii = stylex.defineConsts({
  control: "0px",
  item: "0px",
  row: "0px",
  panel: "0px",
  // A capsule: chips and fields whose ends are fully round, whatever their height.
  pill: "999px",
});

// The macOS app's text sizes (SF Pro, the system font, in both): each its points ÷ 1.1, for the renderer's 110% scale.
// The catalog's sizes (its 14px root): each its pixels ÷ 1.1, for the renderer's 110% scale.
export const fontSizes = stylex.defineConsts({
  label: "10.18px", // .8rem
  small: "10.18px", // .8rem
  caption: "11.45px", // 90%, a chip's
  body: "12.73px", // 1rem
  name: "12.73px", // 1rem, a heading's (bold)
  input: "12.73px", // 14px, a form input's
  message: "12.73px", // 1rem
  pageTitle: "15.27px", // 1.2rem
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
