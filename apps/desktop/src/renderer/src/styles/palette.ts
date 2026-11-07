import * as stylex from "@stylexjs/stylex";
import { paletteSectionMarker } from "./markers.stylex";
import { colors, contentZoom, fontSizes, motion, radii } from "./tokens.stylex";

const below = {
  borderBottomWidth: 1,
  borderBottomStyle: "solid",
  borderBottomColor: colors.panelBorder,
} as const;
const row = { display: "flex", flexShrink: 0, alignItems: "center" } as const;
const text = { default: colors.textPrimary, "::placeholder": colors.textTertiary } as const;

const panelIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px) scale(0.99)" },
});
const backdropIn = stylex.keyframes({ from: { opacity: 0 } });

// Palettes (Palettes.tsx `Modal`) are a modal <dialog>: a `base.panel`, 560px wide, centered, 120px from the top.
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
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    lineHeight: "16px",
    boxShadow: colors.shadowPanel,
    outline: "none",
    animationName: { default: panelIn, [motion.reduced]: "none" },
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
  inputRow: { ...below, ...row, height: 37, padding: "0 10px" },
  input: {
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
  // The tabs under ⌘K's input that narrow what it finds (⌘1–⌘4).
  filters: { ...below, ...row, gap: 4, height: 35, padding: "0 8px" },
  filter: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 22,
    padding: "0 6px",
    borderRadius: radii.control,
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    cursor: "pointer",
  },
  filterChosen: { color: colors.accent, backgroundColor: colors.accentFill },
  filterKey: { opacity: 0.7, wordSpacing: "1px" },
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
  sectionLabel: { ...row, gap: 4, height: 28, padding: "0 14px 0 10px" },
  labelText: { color: colors.textSecondary, fontSize: fontSizes.label },
});

// Compose (⌘⇧N): what you write on top, the model's draft of the thread under it.
export const compose = stylex.create({
  // Holds the panel's keys without changing its layout.
  keys: { display: "contents" },
  // A draft as a page: where a thread's page puts its text (its fields are inset 12px), and as wide.
  page: {
    display: "flex",
    flexDirection: "column",
    maxWidth: 773,
    padding: "40px 32px 48px 40px",
    zoom: contentZoom["--content-zoom"],
  },
  input: {
    ...below,
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
  mentions: { ...below, flexShrink: 0, padding: "4px 0" },
  preview: {
    minHeight: 0,
    padding: "10px 0",
    overflowY: "auto",
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  stale: { opacity: 0.6 },
  // "New thread", and what the model's doing on the right.
  head: {
    ...row,
    gap: 8,
    justifyContent: "space-between",
    height: 22,
    padding: "0 12px",
    color: colors.textSecondary,
    fontSize: fontSizes.label,
  },
  status: { ...row, gap: 8, color: colors.textTertiary },
  redraft: { color: colors.accent, cursor: "pointer" },
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
  // Its status, owner and who's asked, as chips are on the thread page.
  properties: {
    ...row,
    flexWrap: "wrap",
    gap: 12,
    padding: "8px 12px 4px",
    fontSize: fontSizes.body,
  },
  empty: { margin: "8px 12px 0", color: colors.textSecondary },
  // Each ask, as the message from you it will be.
  message: { marginTop: 8, padding: "0 12px" },
  line: { display: "flex", flexWrap: "wrap", gap: 4, alignItems: "baseline", lineHeight: "21px" },
  mention: { fontSize: fontSizes.message },
  askText: {
    flex: 1,
    width: "auto",
    minWidth: 160,
    padding: "0 4px",
    fontSize: fontSizes.message,
    lineHeight: "21px",
  },
  // Save draft, quiet, and Send, the one solid button.
  footer: {
    ...row,
    gap: 2,
    justifyContent: "flex-end",
    padding: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.panelBorder,
    fontSize: fontSizes.body,
  },
  quiet: {
    ...row,
    gap: 6,
    height: 28,
    padding: "0 10px",
    borderRadius: radii.row,
    cursor: "pointer",
  },
  kbd: { opacity: 0.7, font: "inherit" },
});
