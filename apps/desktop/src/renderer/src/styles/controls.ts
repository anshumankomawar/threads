import * as stylex from "@stylexjs/stylex";
import { base } from "./base";
import { colors, fontSizes, layers, motion, radii } from "./tokens.stylex";

// Below, starting at the anchor's left edge (StyleX's types only know single keywords).
const UNDER = "bottom span-right" as "bottom";

// Each style here goes after the `base` styles it names, as in `sx(base.hover, chip.chip)`.
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
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  open: { backgroundColor: colors.bgQuaternary },
  // A chip's menu: a popover in the top layer, under the chip that opened it (its implicit anchor), flipped above
  // when there's no room below.
  menu: {
    minWidth: 160,
    marginTop: 4,
    marginBottom: 4,
    positionArea: UNDER,
    positionTryFallbacks: "flip-block, flip-inline, flip-block flip-inline",
  },
});

export const chipTone = stylex.create({
  muted: { color: colors.textTertiary },
  urgent: { color: colors.urgent },
});

const menuIn = stylex.keyframes({ from: { opacity: 0, transform: "translateY(-2px)" } });

// Every menu shares one panel (after `base.panel`) and one row (after `base.bare`). Keyboard menus mark the row with `itemSelected`; pointer menus use
// `itemHover` (its default restates transparent: StyleX merges whole properties).
export const menu = stylex.create({
  menu: {
    display: "flex",
    flexDirection: "column",
    maxHeight: 320,
    padding: "4px 0",
    overflowY: "auto",
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    lineHeight: "16px",
    boxShadow: colors.shadowPanel,
  },
  // A popover menu: shown only while open (the panel's `display` would otherwise beat the browser's hiding), fading
  // in as it opens.
  popover: {
    display: { default: "none", ":popover-open": "flex" },
    animationName: { default: menuIn, [motion.reduced]: "none" },
    animationDuration: "90ms",
    animationTimingFunction: "ease-out",
  },
  context: { position: "fixed", zIndex: layers.contextMenu, minWidth: 160 },
  // A context menu as macOS draws one (measured off Mail's, in points, ÷ 1.1 for the window's 110%): 5pt in from the
  // panel's top and bottom, 24pt rows inset 5pt from its sides, icons 18pt in, titles in one column 39pt in whether
  // or not a row has an icon, separators 11pt tall inset 17pt, and a 12pt corner.
  // (5pt less the panel's 1px border.)
  compact: { maxHeight: 480, padding: "3.6px 0", borderRadius: 11 },
  // A submenu, beside the row that opens it.
  submenu: { position: "fixed", zIndex: layers.contextMenu, minWidth: 160 },
  entry: {
    display: "flex",
    flexShrink: 0,
    gap: 6,
    alignItems: "center",
    height: 21.8,
    margin: "0 4.5px",
    // A little tighter inside the highlight than Mail's.
    padding: "0 7px 0 7.5px",
    borderRadius: 5,
    color: colors.textPrimary,
    whiteSpace: "nowrap",
    cursor: "default",
    backgroundColor: { default: "transparent", ":hover": colors.panelSelected },
  },
  entryOpen: { backgroundColor: colors.panelSelected },
  entryIcon: { display: "flex", flexShrink: 0, justifyContent: "center", width: 13 },
  entryLabel: { flex: 1, paddingRight: 8 },
  entryChevron: { display: "flex", flexShrink: 0, color: colors.textSecondary },
  // A hotkey at the row's end, quieter than its title.
  entryKeys: {
    flexShrink: 0,
    paddingLeft: 12,
    color: colors.textTertiary,
    letterSpacing: "0.04em",
  },
  entrySeparator: {
    flexShrink: 0,
    height: 1,
    margin: "4.5px 15.5px",
    borderStyle: "none",
    // Faint: it groups rows, and shouldn't read as a line through the menu.
    backgroundColor: colors.strokeTertiary,
  },
  item: {
    display: "flex",
    flexShrink: 0,
    gap: 8,
    alignItems: "center",
    height: 27.5,
    margin: "0 4px",
    padding: "0 8px 1px 6px",
    borderRadius: radii.control,
    color: colors.textPrimary,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  itemHover: { backgroundColor: { default: "transparent", ":hover": colors.panelSelected } },
  itemSelected: { backgroundColor: colors.panelSelected },
  itemIcon: { display: "flex", flexShrink: 0, color: colors.iconTertiary },
  label: { flex: 1 },
  hint: { marginLeft: 6, color: colors.textTertiary },
  accent: { color: colors.accent },
  separator: {
    flexShrink: 0,
    width: "100%",
    height: 1,
    margin: "4px 0",
    borderStyle: "none",
    backgroundColor: colors.panelBorder,
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
    borderRadius: radii.row,
    color: colors.textPrimary,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": colors.bgTertiary },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.35 },
    WebkitAppRegion: "no-drag",
  },
  title: { color: colors.textSecondary },
  end: { display: "flex", flexShrink: 0, gap: 2.5, marginLeft: "auto", paddingRight: 8 },
});

export const link = stylex.create({
  // A name that opens someone's profile; put an author or mention style after it.
  person: { textDecoration: { default: null, ":hover": "underline" }, cursor: "pointer" },
  mention: { color: colors.accent },
  thread: {
    display: "inline-flex",
    gap: 4,
    alignItems: "center",
    maxWidth: "100%",
    height: 20,
    margin: "0 1px",
    padding: "0 6px",
    borderRadius: radii.control,
    color: colors.accent,
    fontSize: "0.9em",
    lineHeight: "20px",
    verticalAlign: 1,
    textDecoration: { default: null, ":hover:not(:disabled)": "underline" },
    backgroundColor: colors.accentFill,
    cursor: { default: "pointer", ":disabled": "default" },
    userSelect: "none",
  },
  threadInByline: { height: 18, fontSize: fontSizes.body },
});

// Class strings for Tiptap's renderHTML, which can't take StyleX objects.
export const editorClass = {
  mention: stylex.attrs(link.mention).class ?? "",
  threadLink: stylex.attrs(base.bare, link.thread).class ?? "",
};

export const button = stylex.create({
  // The one main action somewhere (a table's New, Send): Notion's blue, after `base.bare`.
  solid: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 28,
    marginLeft: 6,
    padding: "0 12px",
    borderRadius: radii.row,
    color: "white",
    fontWeight: 600,
    backgroundColor: { default: colors.primary, ":hover": colors.primaryHover },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.5 },
  },
});

const toastIn = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, 6px)" },
});

const mentionIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-6px)" },
});

// The undo toast at the bottom of the main area, rising in; a mention's at the top right.
export const toast = stylex.create({
  stack: {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 44px)",
    right: 14,
    zIndex: layers.overlay,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 320,
  },
  mention: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 10px 10px 12px",
    boxShadow: colors.shadowFloat,
    cursor: "pointer",
    touchAction: "pan-y",
    userSelect: "none",
    animationName: { default: mentionIn, [motion.reduced]: "none" },
    animationDuration: "160ms",
    animationTimingFunction: "ease-out",
    transitionProperty: "transform, opacity",
    transitionDuration: "180ms",
    transitionTimingFunction: "ease-out",
  },
  moving: { transitionProperty: "none" },
  avatar: { flexShrink: 0, marginTop: 7.5 },
  body: { flex: 1, minWidth: 0 },
  title: { color: colors.textSecondary, fontSize: fontSizes.body },
  emphasis: { color: colors.textPrimary },
  text: {
    display: "-webkit-box",
    marginTop: 2,
    overflow: "hidden",
    color: colors.textPrimary,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  undo: {
    position: "absolute",
    bottom: 20,
    left: "50%",
    zIndex: layers.overlay,
    display: "flex",
    gap: 14,
    alignItems: "center",
    padding: "8px 12px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    boxShadow: colors.shadowFloat,
    transform: "translateX(-50%)",
    animationName: { default: toastIn, [motion.reduced]: "none" },
    animationDuration: "160ms",
    animationTimingFunction: "ease-out",
  },
  action: { color: colors.accent, cursor: "pointer" },
});
