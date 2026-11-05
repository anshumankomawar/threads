import * as stylex from "@stylexjs/stylex";

// Cursor Dark's core palette and the tokens derived from it, as StyleX variables. Dark is the default; `lightTheme`
// (applied to the root by `applyTheme`) is the same tokens, inverted. The "mix" values are the text colour faded to a
// share of itself, as main.css's `color-mix(in srgb, var(--base) N%, transparent)`.
const DARK_BASE = "oklch(0.955 0 0)";
const LIGHT_BASE = "oklch(0.21 0 0)";
const mix = (base: string, percent: number): string =>
  `color-mix(in srgb, ${base} ${percent}%, transparent)`;

export const colors = stylex.defineVars({
  base: DARK_BASE,
  sidebar: "oklch(0.209 0 0)",
  chrome: "oklch(0.191 0 0)",
  // The side panels and the title bar are solid, at the shades they had over the window's glass.
  sidebarSolid: "#1a1a1a",
  textPrimary: DARK_BASE,
  textSecondary: mix(DARK_BASE, 74),
  textTertiary: mix(DARK_BASE, 60),
  // Delta's hover and selected fills: about 5% and 9% of the way from background to text.
  bgTertiary: mix(DARK_BASE, 9),
  bgQuaternary: mix(DARK_BASE, 5),
  iconTertiary: mix(DARK_BASE, 52),
  strokeTertiary: mix(DARK_BASE, 8),
  strokeFocused: mix(DARK_BASE, 15),
  panel: "#171717",
  panelBorder: "#212121",
  panelDivider: "#1c1c1c",
  panelSelected: "#222222",
  accent: "#78aee7",
  accentFill: "#1f252c",
  statusWaiting: "oklch(0.681 0.131 252.629)",
  statusClosed: "oklch(0.713 0.094 155.438)",
  // Blocked is the same red as urgent.
  urgent: "oklch(0.712 0.177 12.651)",
  glass: "rgb(0 0 0 / 62%)",
  overlay: "rgb(0 0 0 / 45%)",
  floatBorder: "rgb(255 255 255 / 8%)",
  onAccent: "#0f141a",
  avatarRing: "transparent",
});

export const lightTheme = stylex.createTheme(colors, {
  base: LIGHT_BASE,
  sidebar: "oklch(0.965 0 0)",
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
  panelDivider: "#ededeb",
  panelSelected: "#efefed",
  accent: "#2f6fb7",
  accentFill: "#e2ecf7",
  statusWaiting: "oklch(0.55 0.15 252.629)",
  statusClosed: "oklch(0.55 0.11 155.438)",
  urgent: "oklch(0.58 0.2 12.651)",
  glass: "rgb(255 255 255 / 72%)",
  overlay: "rgb(0 0 0 / 18%)",
  floatBorder: "rgb(0 0 0 / 8%)",
  onAccent: "#ffffff",
  avatarRing: "rgb(0 0 0 / 14%)",
});

// The sidebar's spacing: how far everything sits from its edges, so icons, times and lines all line up, and the pills
// rows' fills sit in, this far in from the edges, rounded like the tab buttons.
export const sidebarSpace = stylex.defineConsts({
  inset: "12px",
  rowGutter: "6px",
  rowRadius: "6px",
});

// The main content's zoom (⌘+, ⌘-, ⌘0): the thread, list pages and the org view zoom on their own; the sidebar, top bar
// and palettes keep their size. The `--` key keeps the variable's literal name, so App's
// `document.documentElement.style.setProperty("--content-zoom", …)` still drives it. Use `contentZoom["--content-zoom"]`.
export const contentZoom = stylex.defineVars({
  "--content-zoom": "1",
});

// Stacking, lowest to highest: things floating over a page (minimap, new-messages pill, selection bar), the window's
// drag strip and the resize handles, the dim behind palettes (and the undo toast), property dropdowns, the reply's
// caret menus, right-click menus (and the notifications panel), and mention toasts over everything.
export const layers = stylex.defineConsts({
  float: 5,
  titlebar: 10,
  overlay: 20,
  dropdown: 30,
  caretMenu: 50,
  contextMenu: 60,
  toasts: 70,
});

// Corner radii: controls (chips, menu and palette rows, icon buttons), bordered buttons, list rows and cards, and
// floating panels (palettes, menus, toasts).
export const radii = stylex.defineConsts({
  control: "4px",
  button: "5px",
  item: "6px",
  panel: "8px",
});

// The type scale. The body text is 12px (on `body`); messages and titles are 15px; page titles 20px.
export const fontSizes = stylex.defineConsts({
  label: "10px",
  small: "11px",
  body: "12px",
  name: "13px",
  input: "14px",
  message: "15px",
  pageTitle: "20px",
});

// Floating surfaces' shadows: panels that open from something (palettes, menus) and free-floating ones (toasts).
export const shadows = stylex.defineConsts({
  panel: "0 4px 12px rgb(0 0 0 / 28%)",
  float: "0 8px 24px rgb(0 0 0 / 35%)",
});
