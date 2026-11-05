import * as stylex from "@stylexjs/stylex";
import { colors, fontSizes, layers, radii, shadows } from "./tokens.stylex";

const hover = (fill: string) => ({ default: "transparent", ":hover": fill });
const underlineOnHover = { default: null, ":hover": "underline" };

export const chip = stylex.create({
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 22,
    padding: "0 7px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
    color: colors.textSecondary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: hover(colors.bgQuaternary),
    cursor: "pointer",
  },
  open: { backgroundColor: colors.bgQuaternary },
  // Keep the plain `chip-menu` class beside it: the store's keys look for an open menu by class.
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: layers.dropdown,
    minWidth: 160,
  },
});

export const chipTone = stylex.create({
  muted: { color: colors.textTertiary },
  urgent: { color: colors.urgent },
  static: { cursor: "default", backgroundColor: "transparent" },
  assignee: {
    gap: 6,
    height: 21,
    padding: "0 4px",
    borderColor: "transparent",
    color: colors.textPrimary,
    fontSize: fontSizes.name,
    fontWeight: 500,
  },
});

// Every menu shares one panel and one row. Keyboard menus mark the row with `itemSelected`; `role="menu"` menus use
// `itemHover` (its default restates transparent: StyleX merges whole properties).
export const menu = stylex.create({
  menu: {
    display: "flex",
    flexDirection: "column",
    maxHeight: 320,
    padding: "4px 0",
    overflowY: "auto",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
    boxShadow: shadows.panel,
  },
  context: { position: "fixed", zIndex: layers.contextMenu, minWidth: 200 },
  item: {
    display: "flex",
    flexShrink: 0,
    gap: 8,
    alignItems: "center",
    height: 27.5,
    margin: "0 4px",
    padding: "0 8px 1px 6px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.textPrimary,
    font: "inherit",
    textAlign: "left",
    whiteSpace: "nowrap",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  itemHover: { backgroundColor: hover(colors.panelSelected) },
  itemSelected: { backgroundColor: colors.panelSelected },
  shortcut: { marginLeft: "auto", paddingLeft: 16, color: colors.textTertiary, wordSpacing: 1 },
  separator: { flexShrink: 0, height: 1, margin: "4px 0", backgroundColor: colors.panelBorder },
  input: {
    height: 27.5,
    margin: "0 4px 4px",
    padding: "0 8px 1px 6px",
    borderStyle: "none",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.panelBorder,
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: "transparent",
    outline: "none",
  },
});

export const topbar = stylex.create({
  bar: { display: "flex", flexShrink: 0, alignItems: "center", gap: 2.5, height: 34 },
  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    padding: 0,
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.textPrimary,
    backgroundColor: hover(colors.bgTertiary),
    cursor: "pointer",
    WebkitAppRegion: "no-drag",
  },
  buttonOpen: { backgroundColor: colors.bgTertiary },
  title: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.textSecondary,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  end: { display: "flex", flexShrink: 0, gap: 2.5, marginLeft: "auto", paddingRight: 8 },
});

const toastIn = stylex.keyframes({ from: { opacity: 0, transform: "translateY(-6px)" } });

export const toast = stylex.create({
  stack: {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 44px)",
    right: 14,
    zIndex: layers.toasts,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 320,
  },
  toast: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 10px 10px 12px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.floatBorder,
    borderRadius: radii.panel,
    backgroundColor: { default: colors.panel, ":hover": colors.panelSelected },
    boxShadow: shadows.float,
    cursor: "pointer",
    touchAction: "pan-y",
    userSelect: "none",
    animationName: toastIn,
    animationDuration: "160ms",
    animationTimingFunction: "ease-out",
    transitionProperty: "transform, opacity",
    transitionDuration: "180ms",
    transitionTimingFunction: "ease-out",
  },
  moving: { transitionProperty: "none" },
  avatar: { flexShrink: 0, marginTop: 7.5 },
  body: { flex: 1, minWidth: 0 },
  title: {
    overflow: "hidden",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  emphasis: { color: colors.textPrimary },
  text: {
    display: "-webkit-box",
    marginTop: 2,
    overflow: "hidden",
    color: colors.textPrimary,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
});

// A hollow ring while open, filled as work moves along: `sx(status.dot, s !== "open" && statusDot[s])`.
export const status = stylex.create({
  dot: {
    flexShrink: 0,
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: colors.iconTertiary,
    borderRadius: "50%",
  },
  unread: {
    flexShrink: 0,
    width: 6,
    height: 6,
    marginLeft: 2,
    borderRadius: "50%",
    backgroundColor: colors.statusWaiting,
  },
});

const filled = (color: string) => ({ borderColor: color, backgroundColor: color });

export const statusDot = stylex.create({
  blocked: filled(colors.urgent),
  archived: filled(colors.iconTertiary),
  closed: filled(colors.statusClosed),
});

export const link = stylex.create({
  // A name that opens someone's profile; put an author or mention style after it.
  person: {
    padding: 0,
    borderStyle: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    textDecoration: underlineOnHover,
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  personTruncate: { overflow: "hidden", textOverflow: "ellipsis" },
  mention: { color: colors.accent },
  thread: {
    display: "inline-flex",
    gap: 4,
    alignItems: "center",
    maxWidth: "100%",
    height: 20,
    margin: "0 1px",
    padding: "0 6px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.accent,
    font: "inherit",
    fontSize: "0.9em",
    lineHeight: "20px",
    verticalAlign: 1,
    textDecoration: underlineOnHover,
    backgroundColor: colors.accentFill,
    cursor: "pointer",
    userSelect: "none",
  },
  threadInByline: { height: 18, fontSize: fontSizes.body },
});

// Class strings for Tiptap's renderHTML, which can't take StyleX objects.
export const editorClass = {
  mention: stylex.attrs(link.mention).class ?? "",
  threadLink: stylex.attrs(link.thread).class ?? "",
};

export const button = stylex.create({
  button: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 24,
    padding: "0 8px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.button,
    color: colors.textPrimary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: hover(colors.bgQuaternary),
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.5 },
  },
  primary: { borderColor: "transparent", color: colors.accent, backgroundColor: colors.accentFill },
  kbd: { color: colors.textTertiary },
});
