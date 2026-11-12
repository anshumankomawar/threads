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

const EDGE = 14;
const INSET = 8;

const panelIn = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.985)" },
});

// Palettes (Palettes.tsx `Modal`) are a modal <dialog>: a `base.panel`, 560px wide, centered, a little under a fifth of
// the way down (and never running off the bottom). It's there at once: a quick fade, its shadow setting it off.
export const palette = stylex.create({
  dialog: {
    flexDirection: "column",
    width: 640,
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "min(560px, calc(100vh * 0.82 - 24px))",
    // Pinned to the viewport's edges so the auto margins center it.
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    margin: "max(72px, 18vh) auto auto",
    padding: 0,
    overflow: "hidden",
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    lineHeight: "16px",
    // No dimming behind it: its shadow alone lifts it off the app.
    boxShadow: colors.shadowFloat,
    outline: "none",
    animationName: { default: panelIn, [motion.reduced]: "none" },
    animationDuration: "70ms",
    animationTimingFunction: "cubic-bezier(0.2, 0.9, 0.3, 1)",
    "::backdrop": { backgroundColor: "transparent" },
  },
  // `display: flex` only while open, so a closed dialog stays hidden.
  open: { display: { default: "none", ":is([open])": "flex" } },
  // One edge for everything in a palette: what's typed, the tabs' names, headings, rows' icons and the footer all start
  // EDGE in from its side (rows' hints end EDGE from the other), and a highlighted tab or row's wash sits INSET in.
  // No rules between its parts: the input, the tabs and the results are set apart by space alone.
  inputRow: { ...row, height: 38, padding: `0 ${EDGE}px` },
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
    padding: "4px 0 8px",
    overflowY: "auto",
  },
  // The tabs under ⌘K's input that narrow what it finds (⌘1–⌘4).
  filters: { ...row, gap: 2, height: 30, padding: `0 ${INSET}px` },
  filter: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    height: 22,
    padding: `0 ${EDGE - INSET}px`,
    borderRadius: radii.control,
    color: colors.textSecondary,
    fontSize: fontSizes.label,
    cursor: "pointer",
  },
  filterChosen: { color: colors.accent, backgroundColor: colors.accentFill },
  filterKey: { opacity: 0.7, wordSpacing: "1px" },
  // Its rows and headings as the sidebar's (Mail.tsx): 26px rows 2px apart, 22px headings; sections a little apart.
  section: { display: "flex", flexDirection: "column", gap: 2 },
  // A section after another is set apart by a little space, not a rule.
  divided: {
    marginTop: { default: 0, [stylex.when.siblingBefore(":is(*)", paletteSectionMarker)]: 6 },
  },
  sectionLabel: { ...row, gap: 4, height: 22, padding: `0 ${EDGE}px` },
  // A palette's row (OptionButton's `inset`): its wash INSET in from the sides, its icon and hint on the EDGE, its
  // height, corners and icon gap the sidebar's.
  item: {
    gap: 6,
    height: 26,
    margin: `0 ${INSET}px`,
    padding: `0 ${EDGE - INSET}px`,
    borderRadius: radii.row,
  },
  labelText: { color: colors.textSecondary, fontSize: fontSizes.label },
  // Text over a palette's rows (⌘F's answer).
  note: {
    padding: `8px ${EDGE}px 10px`,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
  },
  // A section title's button on its right (⌘F's Clear).
  sectionAction: {
    marginLeft: "auto",
    color: { default: colors.textTertiary, ":hover": colors.textPrimary },
    fontSize: fontSizes.label,
    cursor: "pointer",
  },
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
    borderColor: "transparent",
    borderRadius: radii.control,
    color: text,
    font: "inherit",
    // While you're in it, the same wash as under the pointer: a field, not a ring.
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgQuaternary,
      ":focus": colors.bgQuaternary,
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
