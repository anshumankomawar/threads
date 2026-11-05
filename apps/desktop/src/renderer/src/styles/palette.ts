import * as stylex from "@stylexjs/stylex";
import { paletteSectionMarker } from "./markers.stylex";
import { colors, fontSizes, layers, radii } from "./tokens.stylex";

const base = {
  cut: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  bare: { padding: 0, borderStyle: "none", font: "inherit", backgroundColor: "transparent" },
  below: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.panelBorder,
  },
  flex: { display: "flex", flexShrink: 0, alignItems: "center" },
} as const;
const text = { default: colors.textPrimary, "::placeholder": colors.textTertiary } as const;

// Palettes (components/Palette.tsx) are a menu panel, 560px wide, centered, 120px from the top.
export const palette = stylex.create({
  overlay: { position: "fixed", inset: 0, zIndex: layers.overlay, backgroundColor: colors.overlay },
  panel: { position: "absolute", top: 120, left: "50%", width: 560, maxHeight: 474, padding: 0 },
  // overflowY overrides the menu's.
  centered: { overflowY: "hidden", transform: "translateX(-50%)" },
  inputRow: { ...base.below, ...base.flex, height: 37, padding: "0 10px" },
  input: {
    ...base.bare,
    flex: 1,
    minWidth: 0,
    color: text,
    fontSize: fontSizes.input,
    outline: "none",
  },
  results: { minHeight: 0, paddingTop: 4, overflowY: "auto" },
  section: { display: "flex", flexDirection: "column", paddingBottom: 4 },
  // A section after another gets a divider.
  divided: {
    borderTopWidth: 1,
    borderTopStyle: {
      default: null,
      [stylex.when.siblingBefore(":is(*)", paletteSectionMarker)]: "solid",
    },
    borderTopColor: colors.panelBorder,
  },
  sectionLabel: { ...base.cut, ...base.flex, gap: 4, height: 28, padding: "0 14px 0 10px" },
  labelText: { color: colors.textSecondary, fontSize: fontSizes.label },
  rowDisabled: { color: colors.textTertiary, cursor: "default" },
  rowLabel: { ...base.cut, flex: 1 },
  shortcut: { flexShrink: 0, color: colors.textSecondary, wordSpacing: "2.5px" },
  more: { marginTop: 4, color: colors.textSecondary },
  step: { flexShrink: 0, color: colors.textTertiary, fontSize: fontSizes.small },
  quoted: { ...base.cut, color: colors.textPrimary },
  count: { marginLeft: "auto", color: colors.textTertiary },
  empty: { padding: "4px 10px", color: colors.textTertiary, fontSize: fontSizes.body },
  check: {
    ...base.flex,
    justifyContent: "center",
    width: 16,
    height: 16,
    borderRadius: radii.control,
  },
  checkBox: { borderWidth: 1.5, borderStyle: "solid", borderColor: colors.iconTertiary },
  checked: { borderColor: colors.accent, color: colors.onAccent, backgroundColor: colors.accent },
  tick: { flexShrink: 0, marginLeft: "auto", color: colors.accent },
  chip: { ...base.flex, gap: 6, height: 22, marginRight: 8, padding: "0 8px 0 5px" },
  chipLook: { borderRadius: radii.control, fontSize: fontSizes.body, color: colors.textPrimary },
  chipFill: { backgroundColor: colors.panelSelected },
  side: { ...base.bare, ...base.flex, gap: 6, marginLeft: "auto", cursor: "pointer" },
  sideColor: { color: { default: colors.textSecondary, ":hover": colors.textPrimary } },
  tabs: { ...base.below, ...base.flex, gap: 4, height: 35, padding: "0 8px" },
  tabsLine: { borderBottomColor: colors.panelDivider },
  tab: {
    ...base.bare,
    ...base.flex,
    gap: 5,
    height: 20,
    padding: "0 4px",
    borderRadius: 3,
    cursor: "pointer",
  },
  tabLook: { color: colors.textSecondary, fontSize: "10.5px", cursor: "pointer" },
  tabSelected: { color: colors.accent, backgroundColor: colors.accentFill },
  tabShortcut: { paddingRight: 2, opacity: 0.8 },
});

// ComposePanel: what you write on top, the model's draft of the thread under it.
export const compose = stylex.create({
  panel: { maxHeight: 560 },
  input: { ...base.below, ...base.bare, flexShrink: 0, padding: 12, outline: "none" },
  inputText: { color: text, fontSize: fontSizes.input, lineHeight: "20px", resize: "none" },
  mentions: { ...base.below, flexShrink: 0, padding: "4px 0" },
  preview: {
    minHeight: 0,
    paddingBottom: 10,
    overflowY: "auto",
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  stale: { opacity: 0.6 },
  label: { gap: 8 },
  redraft: { ...base.bare, color: colors.accent, cursor: "pointer" },
  // Fields read as text and edit in place: no box until you're in one.
  field: {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    padding: "2px 6px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "transparent", ":focus": colors.strokeFocused },
    borderRadius: radii.control,
    color: text,
    font: "inherit",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgQuaternary,
      ":focus": "transparent",
    },
    outline: "none",
    resize: "none",
    fieldSizing: "content",
  },
  title: {
    width: "calc(100% - 12px)",
    margin: "0 6px",
    fontSize: fontSizes.message,
    fontWeight: 600,
    lineHeight: "22px",
  },
  context: {
    width: "calc(100% - 12px)",
    margin: "2px 6px 0",
    color: { default: colors.textSecondary, "::placeholder": colors.textTertiary },
  },
  empty: { margin: "6px 12px 0", color: colors.textSecondary },
  asks: { display: "flex", flexDirection: "column", gap: 8, margin: "10px 0 0", padding: "0 6px" },
  ask: { display: "flex", flexDirection: "column", gap: 2 },
  people: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    padding: "0 6px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
  },
  person: { display: "inline-flex", gap: 5, alignItems: "center" },
  remove: {
    ...base.bare,
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    cursor: "pointer",
  },
  footer: {
    ...base.flex,
    gap: 8,
    justifyContent: "space-between",
    padding: "6px 8px 6px 12px",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.panelBorder,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
  },
  kbd: { font: "inherit" },
  actions: { display: "flex", gap: 6 },
});
