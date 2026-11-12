import * as stylex from "@stylexjs/stylex";

// Dark is the default; `lightTheme` (on the root, from `applyTheme`) is the same tokens for light.
const mix = (base: string, percent: number): string =>
  `color-mix(in srgb, ${base} ${percent}%, transparent)`;

// Thunderbird's palette (comm-central's colors.css and layout.css): its layout backgrounds (0 the page, 1 the panes,
// 2-4 the washes), layout colours, neutral borders and the system accent, in dark first, then light.
const DARK = {
  // --layout-background-1, the panes' ground.
  chrome: "#27272a",
  textPrimary: "#f4f4f5",
  textSecondary: "#d4d4d8",
  textTertiary: "#a1a1aa",
  // --treeitem-background-selected (unfocused), and --treeitem-background-hover.
  bgTertiary: "#3f3f46",
  bgQuaternary: "#52525b",
  iconTertiary: "#a1a1aa",
  // --layout-border-0 (--color-neutral-200).
  strokeTertiary: "#4c4d58",
  strokeFocused: "#52525b",
  resizeEdge: "#52525b",
  panel: "#27272a",
  panelBorder: "#4c4d58",
  panelSelected: "#58c9ff",
  raised: "#18181b",
  raisedBorder: "#4c4d58",
  accent: "#58c9ff",
  accentFill: "color-mix(in srgb, #58c9ff 20%, #18181b)",
  primary: "#58c9ff",
  primaryHover: "color-mix(in srgb, #58c9ff 80%, black)",
  statusClosed: "#4ade80",
  urgent: "#f87171",
  avatarRing: "transparent",
  systemBlue: "#58c9ff",
  priority: "#fb923c",
  shadowPanel: "0 2px 8px rgb(0 0 0 / 40%)",
  shadowFloat: "0 4px 16px rgb(0 0 0 / 45%)",
};
export const colors = stylex.defineVars(DARK);

export const lightTheme = stylex.createTheme(colors, {
  chrome: "#fafafa",
  textPrimary: "#18181b",
  textSecondary: "#3f3f46",
  textTertiary: "#71717a",
  bgTertiary: "#d4d4d8",
  bgQuaternary: "#e4e4e7",
  iconTertiary: "#52525b",
  strokeTertiary: "#d9d9de",
  strokeFocused: "#a1a1aa",
  resizeEdge: "#a1a1aa",
  panel: "#ffffff",
  panelBorder: "#d9d9de",
  panelSelected: "#1373d9",
  raised: "#ffffff",
  raisedBorder: "#d9d9de",
  accent: "#1373d9",
  accentFill: "#ddeefe",
  primary: "#1373d9",
  primaryHover: "color-mix(in srgb, #1373d9 80%, black)",
  statusClosed: "#16a34a",
  urgent: "#dc2626",
  avatarRing: "rgb(0 0 0 / 14%)",
  systemBlue: "#1373d9",
  priority: "#ea580c",
  shadowPanel: "0 2px 8px rgb(0 0 0 / 12%)",
  shadowFloat: "0 4px 16px rgb(0 0 0 / 14%)",
});

// The rest of Thunderbird's tokens the panes use: the page (--layout-background-0), the washes, the selected item (the
// system accent, here its blue-60, and its text), the spaces bar's ground (--color-surface-lower), cards, buttons,
// count badges, the unread dot, and its folder colours (folderColors.css).
const TB_DARK = {
  page: "#18181b",
  bg2: "#3f3f46",
  bg3: "#52525b",
  bg4: "#71717a",
  border1: "#52525b",
  selected: "#58c9ff",
  selectedText: "#18181b",
  spaces: "#111113",
  cardBorder: "#4c4d58",
  button: "#52525b",
  buttonHover: "#71717a",
  buttonActive: "#3f3f46",
  badge: "#71717a",
  newBadge: "#2493ef",
  newText: "#4cb1f9",
  unreadFill: "#4ade80",
  unreadStroke: "#16a34a",
  inbox: "#58c9ff",
  draft: "#ddb4fe",
  sent: "#c0f2cf",
  archive: "#fee78a",
  folder: "#fee78a",
  trash: "#d4d4d8",
  avatar: "#52525b",
  avatarText: "#a1a1aa",
};
export const tb = stylex.defineVars(TB_DARK);
export const tbLight = stylex.createTheme(tb, {
  page: "#ffffff",
  bg2: "#f4f4f5",
  bg3: "#e4e4e7",
  bg4: "#d4d4d8",
  border1: "#a1a1aa",
  selected: "#1373d9",
  selectedText: "#ffffff",
  spaces: "#f7f7f8",
  cardBorder: "#d9d9de",
  button: "#e4e4e7",
  buttonHover: "#f4f4f5",
  buttonActive: "#d4d4d8",
  badge: "#71717a",
  newBadge: "#1373d9",
  newText: "#1373d9",
  unreadFill: "#4ade80",
  unreadStroke: "#16a34a",
  inbox: "#1373d9",
  draft: "#ae55f7",
  sent: "#1d783b",
  archive: "#713f12",
  folder: "#eabd08",
  trash: "#52525b",
  avatar: "#d4d4d8",
  avatarText: "#71717a",
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
// Thunderbird's corners: 3px on buttons, rows and cards (--button-border-radius, --listbox-border-radius); its panels
// a little rounder.
export const radii = stylex.defineConsts({
  control: "3px",
  item: "3px",
  row: "3px",
  panel: "6px",
  // A capsule: chips and fields whose ends are fully round, whatever their height.
  pill: "999px",
});

// The macOS app's text sizes (SF Pro, the system font, in both): each its points ÷ 1.1, for the renderer's 110% scale.
// Thunderbird on macOS: the system font at 13px (1rem), its sizes as rems of it, ÷ 1.1 for the 110% scale.
export const fontSizes = stylex.defineConsts({
  label: "9.45px", // 0.8rem
  small: "10.05px", // 0.85rem, a count badge
  caption: "11.23px", // 0.95rem, a card's sender and date
  body: "11.82px", // 1rem
  name: "11.82px", // 1rem
  input: "11.82px", // 1rem
  message: "11.82px", // 1rem, a message's body
  pageTitle: "14.18px", // 1.2rem, a message's subject
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
