import * as stylex from "@stylexjs/stylex";
import { colors, fontSizes, layers, radii, shadows } from "../styles/tokens.stylex";

// ThreadView's own parts: the shared page layout (view, doc, block, header, title, messages' text) is `thread` in
// styles/thread.ts.
export const styles = stylex.create({
  // .thread-overscroll — the viewport minus about one block, so the last entry can reach the top but never leave the
  // screen. Keep the plain `thread-overscroll` class beside it (the background click handler checks for it).
  overscroll: {
    height: "calc(100vh - 34px - 140px)",
  },
  // .thread-time
  time: {
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  // .thread-header .thread-properties — task properties under the ask: compact chips like the search tabs, each
  // opening a small menu. Who and when sit just above the title, the description follows it, and the properties come
  // last with a little more room, so the heading reads as title then description.
  properties: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px",
    marginTop: "4px",
  },
  // .chip-anchor — a chip and its menu, which opens under it.
  chipAnchor: {
    position: "relative",
    display: "inline-flex",
  },

  // Who a message went to, or that it's a note nobody was told about.
  // .thread-sent-to
  sentTo: {
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  // .thread-note
  note: {
    padding: "0 5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
    color: colors.textTertiary,
    fontSize: "10.5px",
    lineHeight: "15px",
  },

  // Selecting messages to move: a run of selected neighbours reads as one tinted box with an accent edge, rounded
  // only at its ends. The tint fills the gap between them, and while selecting a click picks a message, not text.
  // .thread-message
  message: {
    position: "relative",
    isolation: "isolate",
  },
  // .thread-message[data-selected="true"]::before
  selected: {
    "::before": {
      content: '""',
      position: "absolute",
      top: "-7px",
      right: "-10px",
      bottom: "-7px",
      left: "-10px",
      zIndex: -1,
      borderTopLeftRadius: radii.item,
      borderTopRightRadius: radii.item,
      borderBottomLeftRadius: radii.item,
      borderBottomRightRadius: radii.item,
      backgroundColor: colors.accentFill,
      boxShadow: `inset 2px 0 ${colors.accent}`,
    },
  },
  // .thread-message[data-run="start"]::before — after `selected`.
  runStart: {
    "::before": {
      bottom: "-10.25px",
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
  },
  // .thread-message[data-run="middle"]::before
  runMiddle: {
    "::before": {
      top: "-10.25px",
      bottom: "-10.25px",
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
  },
  // .thread-message[data-run="end"]::before
  runEnd: {
    "::before": {
      top: "-10.25px",
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    },
  },
  // .thread-message[data-selecting="true"]
  selecting: {
    cursor: "pointer",
    userSelect: "none",
  },

  // Activity lines: one short line each, tucked closer to the messages around them, and nearly touching when several
  // come in a row (a run of status changes reads as one small group).
  // .thread-event
  event: {
    marginBlock: "-6px",
  },
  // .thread-event + .thread-event — an activity line right after another: after `event`.
  eventAfterEvent: {
    marginTop: "-14.5px",
  },
  // .thread-event-marker — no marker, just the avatar's width: after `thread.avatar`.
  eventMarker: {
    alignItems: "center",
    justifyContent: "center",
    height: "18px",
    marginTop: 0,
  },
  // .thread-event-text
  eventText: {
    flex: 1,
    minWidth: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    lineHeight: "18px",
  },
  // .thread-event-actor
  eventActor: {
    color: colors.textSecondary,
  },
  // .thread-resolution-marker — the resolution that closes the thread: after `thread.avatar`.
  resolutionMarker: {
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    marginInline: "1px",
    borderRadius: "50%",
    color: colors.statusClosed,
    backgroundColor: `color-mix(in srgb, ${colors.statusClosed} 18%, transparent)`,
  },

  // .thread-reply — holds the reply's editor.
  reply: {
    display: "flex",
    flex: 1,
    minWidth: 0,
  },
  // .thread-reply-editor — the editor's root, after `thread.text`. Its paragraphs and placeholder stay global
  // (ProseMirror makes them).
  replyEditor: {
    minHeight: "21px",
    outline: "none",
    cursor: "text",
  },
  // The reply's To line, once someone's mentioned: who Enter sends to.
  // .reply-to
  replyTo: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    marginTop: "8px",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  // .reply-to-label
  replyToLabel: {
    marginRight: "2px",
  },
  // .reply-to-person
  replyToPerson: {
    display: "inline-flex",
    gap: "5px",
    alignItems: "center",
    height: "22px",
    padding: "0 4px 0 6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.item,
    color: colors.textSecondary,
  },
  // .reply-to-remove
  replyToRemove: {
    display: "flex",
    padding: "2px",
    borderStyle: "none",
    color: {
      default: colors.iconTertiary,
      ":hover": colors.textPrimary,
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },

  // .thread-menu — the `#`, `@` and `/` menus in a reply, at the caret: after `menu.menu`. Keep the plain
  // `thread-menu` class beside it (App's keys look for an open menu by it).
  threadMenu: {
    position: "fixed",
    zIndex: layers.caretMenu,
    width: "300px",
  },
  // .thread-menu-title
  threadMenuTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    color: colors.textPrimary,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // .thread-menu-new
  threadMenuNew: {
    color: colors.accent,
  },
  // .thread-menu-hint
  threadMenuHint: {
    marginLeft: "6px",
    color: colors.textTertiary,
  },
  // .thread-link-self — a link to the thread you're in: plain text, nowhere to go.
  linkSelf: {
    color: colors.textSecondary,
  },

  // .thread-new-pill — shown while you're reading back and something new arrives; clicking it returns to the reply.
  newPill: {
    position: "absolute",
    bottom: "16px",
    left: "50%",
    zIndex: layers.float,
    display: "inline-flex",
    gap: "6px",
    alignItems: "center",
    height: "26px",
    padding: "0 12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: "13px",
    color: colors.textPrimary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: {
      default: colors.panel,
      ":hover": colors.panelSelected,
    },
    boxShadow: shadows.panel,
    cursor: "pointer",
    transform: "translateX(-50%)",
  },

  // .selection-bar — the selected messages' actions, floating at the bottom.
  selectionBar: {
    position: "absolute",
    bottom: "16px",
    left: "50%",
    zIndex: layers.float,
    display: "inline-flex",
    gap: "4px",
    alignItems: "center",
    height: "30px",
    padding: "0 4px 0 12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    backgroundColor: colors.panel,
    boxShadow: shadows.panel,
    transform: "translateX(-50%)",
  },
  // .selection-bar-count
  selectionBarCount: {
    marginRight: "6px",
  },
  // .selection-bar-move
  selectionBarMove: {
    display: "inline-flex",
    gap: "6px",
    alignItems: "center",
    height: "22px",
    padding: "0 8px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.panelSelected,
    },
    cursor: "pointer",
  },
  // .icon-button.selection-bar-clear — Delta's 22px icon button, quiet until hovered.
  selectionBarClear: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    padding: 0,
    borderStyle: "none",
    borderRadius: radii.control,
    color: {
      default: colors.textTertiary,
      ":hover": colors.textPrimary,
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },
});
