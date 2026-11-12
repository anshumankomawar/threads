import * as stylex from "@stylexjs/stylex";
import { peekMarker } from "./markers.stylex";
import { colors, contentZoom, fontSizes } from "./tokens.stylex";

// A conversation's geometry: the space between turns, and each avatar's size and drop (centred on a turn's name and
// first line).
// Things' rhythm: 16pt between turns, a 20pt face level with the name.
export const TURN_GAP = 15;
export const AVATAR = 20;
const AVATAR_TOP = 0;

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
    // In the middle of its pane, as Things sets a list, about as wide as one.
    maxWidth: 680,
    width: "100%",
    marginInline: "auto",
    boxSizing: "border-box",
    padding: {
      default: "4px 28px 48px",
      [stylex.when.ancestor(":is(*)", peekMarker)]: "16px 24px 32px",
    },
    zoom: contentZoom["--content-zoom"],
  },
  block: { position: "relative", display: "flex", gap: 9, scrollMarginTop: 14 },
  // Things' page head: the title, a quiet line under it, then its tags; a hairline before the conversation.
  header: {
    paddingBottom: 14,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.strokeTertiary,
  },
  headerBody: { display: "flex", flexDirection: "column" },
  // Put `threadLineMarker` beside it so the title after it moves up.
  byline: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
    marginTop: 3,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
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
  // The thread's name as a Things page's title: 20pt bold.
  headerTitle: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.pageTitle,
    fontWeight: 700,
    lineHeight: "24px",
    letterSpacing: "-0.01em",
    overflowWrap: "anywhere",
    userSelect: "text",
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
  // A turn: the name in 13pt semibold, when beside it, then what they said in 13pt on 18pt lines, as Things' notes.
  meta: { display: "flex", alignItems: "baseline", gap: 6, lineHeight: "18px" },
  author: { color: colors.textPrimary, fontSize: fontSizes.body, fontWeight: 600 },
  text: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    lineHeight: "17px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});
