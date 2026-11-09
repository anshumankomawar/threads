import * as stylex from "@stylexjs/stylex";
import { peekMarker } from "./markers.stylex";
import { colors, contentZoom, fontSizes as size, radii } from "./tokens.stylex";

const muted = colors.textTertiary;

// The label and person pages. The main content zooms on its own (⌘+, ⌘-, ⌘0).
export const page = stylex.create({
  page: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    // In the reading pane, just under its toolbar, as a thread starts.
    padding: {
      default: "12px 52px 48px",
      [stylex.when.ancestor(":is(*)", peekMarker)]: "16px 24px 32px",
    },
    overflowY: "auto",
    zoom: contentZoom["--content-zoom"],
  },
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: size.pageTitle,
    fontWeight: 600,
    lineHeight: "28px",
    letterSpacing: "-0.2px",
    fontFeatureSettings: '"calt"',
  },
  summary: { margin: "2px 0 0", color: muted },
  // A subspace's description, under its name: plain text, which members edit in place.
  description: {
    maxWidth: 640,
    margin: "8px 0 0",
    color: colors.textSecondary,
    fontSize: size.body,
    lineHeight: "20px",
    whiteSpace: "pre-wrap",
  },
  descriptionField: {
    display: "block",
    width: "100%",
    outline: "none",
    resize: "none",
    fieldSizing: "content",
    "::placeholder": { color: muted },
  },
  titleRow: { display: "flex", gap: 6, alignItems: "center" },
  // A search field in a table's toolbar: an icon and the input in a bordered box.
  search: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    width: 180,
    height: 28,
    marginRight: 4,
    padding: "0 8px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.row,
    color: colors.iconTertiary,
    cursor: "text",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: size.body,
    outline: "none",
    "::placeholder": { color: muted },
  },
  setting: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    padding: "10px 0",
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.strokeTertiary,
  },
  header: { display: "flex", gap: 14, alignItems: "center" },
  // Small building blocks the pages combine, after the `base` styles.
  pointer: { cursor: "pointer" },
  small: { color: muted, fontSize: size.body },
  narrow: { maxWidth: 640 },
  itemBody: { display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 },
  itemName: { display: "flex", gap: 6, alignItems: "center", color: colors.textPrimary },

  filterPill: {
    display: "inline-flex",
    gap: 6,
    alignItems: "center",
    height: 24,
    padding: "0 10px",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.pill,
    color: colors.accent,
    fontSize: size.body,
    cursor: "pointer",
  },
  // A cell with an icon or face before its text.
  inCell: { display: "flex", gap: 6, alignItems: "center", minWidth: 0 },
  titleText: { fontWeight: 500 },
  // Notion's select and status values.
  pill: {
    display: "inline-flex",
    gap: 6,
    alignItems: "center",
    maxWidth: "100%",
    height: 20,
    padding: "0 6px",
    borderRadius: radii.row,
    color: colors.textSecondary,
    backgroundColor: colors.bgTertiary,
  },
  avatars: { display: "flex" },
  // Each face overlaps the one before it.
  avatar: { marginLeft: { default: -4, ":first-child": 0 } },
  // A hotkey's keys, which you click to change: a rounded fill of their own on hover.
  keysButton: {
    display: "flex",
    alignItems: "center",
    height: 26,
    margin: "0 -6px",
    padding: "0 6px",
    borderRadius: radii.row,
    cursor: "pointer",
  },
  recordingButton: { backgroundColor: colors.accentFill },
  recording: { color: colors.accent },
  // A quiet text button among a tab's tools.
  quiet: { height: 28, padding: "0 10px", borderRadius: radii.row, cursor: "pointer" },
  // Keys as key caps, as Superhuman shows them.
  caps: { display: "inline-flex", gap: 3 },
  cap: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 20,
    height: 20,
    padding: "0 5px",
    borderRadius: radii.control,
    color: colors.textSecondary,
    fontFamily: "inherit",
    fontSize: size.label,
    backgroundColor: colors.bgTertiary,
  },
});
