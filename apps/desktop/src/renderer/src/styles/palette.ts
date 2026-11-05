import * as stylex from "@stylexjs/stylex";
import { paletteSectionMarker } from "./markers.stylex";
import { colors, fontSizes, radii, shadows } from "./tokens.stylex";

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
const reduced = "@media (prefers-reduced-motion: reduce)";

const panelIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px) scale(0.99)" },
});
const backdropIn = stylex.keyframes({ from: { opacity: 0 } });

// Palettes (Palettes.tsx `Modal`) are a modal <dialog>: a menu panel, 560px wide, centered, 120px from the top.
export const palette = stylex.create({
  dialog: {
    flexDirection: "column",
    width: 560,
    maxWidth: "calc(100vw - 32px)",
    maxHeight: 474,
    // Pinned to the viewport's edges so the auto margins center it.
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    margin: "120px auto auto",
    padding: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    lineHeight: "16px",
    backgroundColor: colors.panel,
    boxShadow: shadows.panel,
    outline: "none",
    animationName: { default: panelIn, [reduced]: "none" },
    animationDuration: "120ms",
    animationTimingFunction: "ease-out",
    "::backdrop": {
      backgroundColor: colors.overlay,
      animationName: backdropIn,
      animationDuration: "120ms",
      animationTimingFunction: "ease-out",
    },
  },
  // `display: flex` only while open, so a closed dialog stays hidden.
  open: { display: { default: "none", ":is([open])": "flex" } },
  inputRow: { ...base.below, ...base.flex, height: 37, padding: "0 10px" },
  input: {
    ...base.bare,
    flex: 1,
    minWidth: 0,
    color: text,
    fontSize: fontSizes.input,
    outline: "none",
  },
  results: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    paddingTop: 4,
    overflowY: "auto",
  },
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
  rowLabel: { ...base.cut, flex: 1 },
  shortcut: { flexShrink: 0, color: colors.textSecondary, wordSpacing: "2.5px" },
});

// Compose (⌘⇧N): what you write on top, the model's draft of the conversation under it.
export const compose = stylex.create({
  input: {
    ...base.below,
    ...base.bare,
    flexShrink: 0,
    minHeight: 88,
    padding: 12,
    color: text,
    fontSize: fontSizes.input,
    lineHeight: "20px",
    outline: "none",
    resize: "none",
    fieldSizing: "content",
  },
  preview: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    padding: "10px 12px",
    overflowY: "auto",
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  stale: { opacity: 0.6 },
  label: { paddingLeft: 0 },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.message,
    fontWeight: 600,
    lineHeight: "22px",
  },
  context: { marginTop: 2, color: colors.textSecondary, whiteSpace: "pre-wrap" },
  asks: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 },
  ask: { display: "flex", flexDirection: "column", gap: 2 },
  people: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
  },
  person: { display: "inline-flex", gap: 5, alignItems: "center" },
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
  kbd: { color: "inherit", font: "inherit" },
  actions: { display: "flex", gap: 6 },
});
