import * as stylex from "@stylexjs/stylex";
import { threadLineMarker } from "./markers.stylex";
import { colors, contentZoom, fontSizes } from "./tokens.stylex";

// A thread as a document (ThreadView): avatars at 15px, text at 52px, about 706px wide.
export const thread = stylex.create({
  view: { position: "relative", display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  doc: {
    display: "flex",
    flexDirection: "column",
    gap: 20.5,
    maxWidth: 773,
    margin: "0 auto",
    padding: "13.75px 15px 48px",
    zoom: contentZoom["--content-zoom"],
  },
  block: { display: "flex", gap: 15, scrollMarginTop: 14 },
  header: { paddingBottom: 12 },
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
  },
  headerTitle: {
    marginTop: { default: null, [stylex.when.siblingBefore(":is(*)", threadLineMarker)]: -6 },
  },
  avatar: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    width: 22,
    height: 20,
    marginTop: 10.5,
  },
  body: { display: "flex", flex: 1, flexDirection: "column", minWidth: 0 },
  meta: { display: "flex", alignItems: "baseline", gap: 8, lineHeight: "21px" },
  author: { color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 500 },
  text: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.message,
    lineHeight: "21px",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
});
