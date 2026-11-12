import * as stylex from "@stylexjs/stylex";
import { peekMarker, threadLineMarker } from "./markers.stylex";
import { colors, contentZoom, fontSizes } from "./tokens.stylex";

// A conversation's geometry: the space between turns, and each avatar's size and drop (centred on a turn's name and
// first line).
export const TURN_GAP = 28;
export const AVATAR = 28;
const AVATAR_TOP = 8;

// A thread as a document (ThreadView): left-aligned like the other pages, about 706px of text.
export const thread = stylex.create({
  // A size container, so what's after the last entry can be measured against the thread's own height (cqh), wherever
  // it's shown: the reading pane, the split, Peek.
  view: {
    position: "relative",
    display: "flex",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    containerType: "size",
  },
  scroll: { flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto" },
  doc: {
    display: "flex",
    flexDirection: "column",
    gap: TURN_GAP,
    // Left-aligned, on the same edge as the other pages; in the reading pane, just under its toolbar.
    maxWidth: 773,
    padding: {
      default: "12px 32px 48px 52px",
      [stylex.when.ancestor(":is(*)", peekMarker)]: "16px 24px 32px",
    },
    zoom: contentZoom["--content-zoom"],
  },
  block: { position: "relative", display: "flex", gap: 14, scrollMarginTop: 14 },
  header: { paddingBottom: 4 },
  headerBody: { display: "flex", flexDirection: "column", gap: 6 },
  // Put `threadLineMarker` beside it so the title after it moves up.
  byline: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
    minHeight: 21,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
  },
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.message,
    fontWeight: 500,
    lineHeight: "22px",
    overflowWrap: "anywhere",
    userSelect: "text",
    fontFeatureSettings: '"calt"',
  },
  headerTitle: {
    marginTop: { default: null, [stylex.when.siblingBefore(":is(*)", threadLineMarker)]: -6 },
  },
  description: { whiteSpace: "pre-wrap", userSelect: "text" },
  headerDescription: { marginTop: -4 },
  avatar: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    width: AVATAR,
    height: AVATAR,
    marginTop: AVATAR_TOP,
  },
  body: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  meta: { display: "flex", alignItems: "baseline", gap: 8, lineHeight: "22px" },
  author: { color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 500 },
  text: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.message,
    lineHeight: "22px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});
