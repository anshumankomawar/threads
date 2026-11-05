import * as stylex from "@stylexjs/stylex";
import { threadLineMarker } from "./markers.stylex";
import { colors, contentZoom, fontSizes } from "./tokens.stylex";

// A thread's page, shared by ThreadView, DraftView and App's split panes. Apply with
// `{...stylex.attrs(thread.block, thread.header)}`. ThreadView's own parts (messages and their selection, events,
// the resolution, the reply and its editor, properties, the minimap, the new-messages pill, the caret menus) stay with
// it. Hook classes: keep `thread-view` on the view (App selects `.thread-panes > .thread-view .thread-reply-editor` to
// focus the reply with R), and `thread-overscroll` on the overscroll spacer (ThreadView's click handler checks for it).
//
// Delta's thread layout: one left-aligned document; avatars at 15px, text at 52px, about 706px wide.
export const thread = stylex.create({
  // .thread-view — holds the scrolling document and the minimap that floats over its right edge. Keep the plain
  // `thread-view` class beside it (see above).
  view: {
    position: "relative",
    display: "flex",
    flex: 1,
    minHeight: 0,
    // Beside a split pane it shrinks rather than pushing the pane off screen.
    minWidth: 0,
  },
  // .thread-scroll
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  // .thread-doc — a reading column centred in the main area, as in Things. The main content zooms on its own (⌘+, ⌘-,
  // ⌘0); the sidebar, top bar and palettes keep their size.
  doc: {
    display: "flex",
    flexDirection: "column",
    gap: "20.5px",
    maxWidth: "773px",
    margin: "0 auto",
    padding: "13.75px 15px 48px",
    zoom: contentZoom["--content-zoom"],
  },
  // .thread-block — one entry: avatar column, then the body.
  block: {
    display: "flex",
    gap: "15px",
    scrollMarginTop: "14px",
  },

  // A thread's header, in the column the conversation's text uses: title, byline, properties, then the rest of the
  // opening message, with room before the conversation starts. The thread opens like its first message (avatar, who
  // and when), with the title as its subject line.
  // .thread-header — in ThreadView it's also a block: `stylex.attrs(thread.block, thread.header)`.
  header: {
    paddingBottom: "12px",
  },
  // .thread-header .thread-body — add after `body` on the header's body: `stylex.attrs(thread.body, thread.headerBody)`.
  headerBody: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  // .thread-byline — who and when sit just above the title. Put `threadLineMarker` on it (and on the header's
  // `thread.meta`) so the title after it moves up: `stylex.attrs(thread.byline, threadLineMarker)`.
  byline: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    minHeight: "21px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
  },
  // .thread-byline svg — on every icon in a byline, including a ThreadLinkChip's icon when the chip sits in one (StyleX
  // can't reach into children, so pass it down).
  bylineIcon: {
    color: colors.iconTertiary,
  },

  // The thread's title, the same on every kind: a compact heading aligned with the text column. The thread's name, a
  // touch bolder than its messages: a subject line, not a page title.
  // .thread-title
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.message,
    fontWeight: 500,
    lineHeight: "22px",
    overflowWrap: "anywhere",
    userSelect: "text",
  },
  // .thread-header .thread-meta + .thread-title, .thread-header .thread-byline + .thread-title — add after `title` in
  // a header; it moves up only when a sibling before it carries `threadLineMarker` (the header's meta or byline).
  headerTitle: {
    marginTop: {
      default: null,
      [stylex.when.siblingBefore(":is(*)", threadLineMarker)]: "-6px",
    },
  },
  // .thread-description — the description follows the title: `stylex.attrs(thread.text, thread.description)`.
  description: {
    whiteSpace: "pre-wrap",
    userSelect: "text",
  },
  // .thread-header .thread-title + .thread-description — add after `description` in a header, where it always follows
  // the title.
  headerDescription: {
    marginTop: "-4px",
  },

  // 20px avatar in a 22px column, starting just below the top of the name so the name leads the row. The avatar (or
  // marker) is centered between the first two lines: the author's name and the first line of text.
  // .thread-avatar — ThreadView's event and resolution markers add their own styles after it.
  avatar: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    width: "22px",
    height: "20px",
    marginTop: "10.5px",
  },
  // .thread-body
  body: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
  },
  // .thread-meta — author line, on the avatar's row. In a header, add `threadLineMarker` (see `headerTitle`).
  meta: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    lineHeight: "21px",
  },
  // .thread-author — also on an author that's a person link: `stylex.attrs(controls.personLink, thread.author)`, author
  // last, so its colour and size win (main.css's `.thread-author.person-link`).
  author: {
    color: colors.textPrimary,
    fontSize: fontSizes.name,
    fontWeight: 500,
  },
  // .thread-resolution .thread-author — the author line of the resolution that closes the thread: add after `author`.
  authorResolved: {
    color: colors.statusClosed,
  },
  // .thread-text — a message's text. The reply's Tiptap editor takes it as a class string through
  // `editorProps.attributes.class` (`stylex.attrs(thread.text).class`), keeping its `thread-reply-editor` hook class
  // beside it (App focuses it by that class).
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
