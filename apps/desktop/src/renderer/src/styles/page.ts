import * as stylex from "@stylexjs/stylex";
import { colors, contentZoom, fontSizes as size, radii } from "./tokens.stylex";

const muted = colors.textTertiary;

// The label, person, profile and settings pages. The main content zooms on its own (⌘+, ⌘-, ⌘0).
export const page = stylex.create({
  page: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    padding: "52px 15px 48px 52px",
    overflowY: "auto",
    zoom: contentZoom["--content-zoom"],
  },
  // Profile and settings: the title where a thread's title sits.
  top: { paddingTop: "calc(13.75px + 4px)" },
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: size.pageTitle,
    fontWeight: 600,
    lineHeight: "28px",
    letterSpacing: "-0.2px",
  },
  summary: { margin: "2px 0 0", color: muted },
  summaryIcon: { verticalAlign: "-1px" },
  heading: { margin: "32px 0 0", color: colors.textPrimary, fontSize: size.input, fontWeight: 600 },
  subheading: { margin: "28px 0 8px", color: colors.textSecondary, fontWeight: 500 },
  body: { fontSize: size.body },
  header: { display: "flex", gap: 14, alignItems: "center" },
  // Small building blocks the pages combine.
  bare: { padding: 0, borderStyle: "none", font: "inherit", backgroundColor: "transparent" },
  pointer: { cursor: "pointer" },
  list: { margin: 0, padding: 0, listStyle: "none" },
  row: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" },
  border: { borderWidth: 1, borderStyle: "solid", borderColor: colors.strokeTertiary },
  muted: { color: muted },
  small: { color: muted, fontSize: size.body },
  narrow: { maxWidth: 640 },
  items: { display: "flex", flexDirection: "column", gap: 2, margin: "12px 0 0 -8px" },
  item: { display: "flex", gap: 10, alignItems: "flex-start", width: "100%", padding: 8 },
  itemLook: { borderRadius: radii.item, color: "inherit", textAlign: "left" },
  hover: { backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary } },
  itemIcon: { display: "flex", marginTop: 3, color: colors.iconTertiary },
  itemBody: { display: "flex", flex: 1, flexDirection: "column", gap: 2, minWidth: 0 },
  itemName: { display: "flex", gap: 6, alignItems: "center", color: colors.textPrimary },
  noShrink: { flexShrink: 0 },
  actions: { display: "flex", gap: 12, marginTop: 10 },
  action: { color: { default: muted, ":hover": colors.textPrimary } },
  toolbar: { gap: 10, marginTop: 22 },
  newButton: {
    height: 24,
    padding: "0 9px",
    borderColor: colors.strokeFocused,
    borderRadius: radii.button,
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: { default: "transparent", ":hover": colors.bgTertiary },
  },
  filters: { marginLeft: "auto" },
  empty: { margin: "16px 0 0", color: muted },
  // Facts and settings: a label column, then the value.
  facts: { display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 20px", margin: "20px 0 0" },
  value: { margin: 0, color: colors.textPrimary },
});
