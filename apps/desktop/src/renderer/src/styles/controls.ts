import * as stylex from "@stylexjs/stylex";
import { colors, fontSizes, layers, radii, shadows } from "./tokens.stylex";

// Controls used across the app: chips, menus, the top bar, toasts, status and unread dots, links to people and
// threads, and the bordered buttons. Apply with `{...stylex.attrs(controls.chip, open() && controls.chipOpen)}`.

// Chips: task properties under the ask and filter toggles on list pages; compact, like the search tabs, each opening
// a small menu. Apply `chip`, then its open state, then one tone from `chipTone` by its old `data-tone`:
// `stylex.attrs(chip.chip, open() && chip.open, tone && chipTone[tone])`.
export const chip = stylex.create({
  // .chip
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    height: "22px",
    padding: "0 7px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeTertiary,
    borderRadius: radii.control,
    color: colors.textSecondary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgQuaternary,
    },
    cursor: "pointer",
  },
  // .chip[aria-expanded="true"] — its menu is open. Keep aria-expanded.
  open: {
    backgroundColor: colors.bgQuaternary,
  },
  // .thread-header .chip[data-tone="assignee"] — the assignee chip in a thread's header: after its tone.
  assigneeInHeader: {
    fontSize: fontSizes.body,
  },
  // .chip-menu — a chip's dropdown, under it: `stylex.attrs(menu.menu, chip.menu)`. Keep the plain `chip-menu` class
  // beside it: App's keys check `document.querySelector(".chip-menu, .context-menu, .thread-menu")` for an open menu.
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: layers.dropdown,
    minWidth: "160px",
  },
});

// .chip[data-tone="…"] — `chipTone[tone]` for tone "muted" | "urgent" | "static" | "assignee", after `chip.chip`.
export const chipTone = stylex.create({
  // .chip[data-tone="muted"]
  muted: {
    color: colors.textTertiary,
  },
  // .chip[data-tone="urgent"]
  urgent: {
    color: colors.urgent,
  },
  // .chip[data-tone="static"] — not a button: no pointer, no hover fill.
  static: {
    cursor: "default",
    backgroundColor: "transparent",
  },
  // .chip[data-tone="assignee"] — the assignee sits inline in the author line, so it drops the border.
  assignee: {
    gap: "6px",
    height: "21px",
    padding: "0 4px",
    borderColor: "transparent",
    color: colors.textPrimary,
    fontSize: fontSizes.name,
    fontWeight: 500,
  },
});

// Every menu: right-click menus, the property dropdowns and the reply's `#` `@` `/` menus share one panel and one row.
// Menus you move through with the keyboard mark the row with aria-selected (add `itemSelected`); the others highlight
// on hover (`role="menu"` menus: add `itemHover` to each row).
export const menu = stylex.create({
  // .menu
  menu: {
    display: "flex",
    flexDirection: "column",
    // About eleven rows; longer lists, like everyone in the org, scroll.
    maxHeight: "320px",
    padding: "4px 0",
    overflowY: "auto",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
    boxShadow: shadows.panel,
  },
  // .context-menu — right-click menus, at the pointer: `stylex.attrs(menu.menu, menu.context)`, position inline. Keep
  // the plain `context-menu` class beside it (App's `document.querySelector`, see `chip.menu`).
  context: {
    position: "fixed",
    zIndex: layers.contextMenu,
    minWidth: "200px",
  },
  // .menu-item
  item: {
    display: "flex",
    flexShrink: 0,
    gap: "8px",
    alignItems: "center",
    height: "27.5px",
    margin: "0 4px",
    padding: "0 8px 1px 6px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.textPrimary,
    font: "inherit",
    textAlign: "left",
    whiteSpace: "nowrap",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  // .menu[role="menu"] .menu-item:hover — rows of a `role="menu"` menu (ContextMenu, the chip menus) fill on hover.
  // The default restates `item`'s transparent: StyleX merges whole properties, so a null default would leave the
  // button's own grey.
  itemHover: {
    backgroundColor: {
      default: "transparent",
      ":hover": colors.panelSelected,
    },
  },
  // .menu-item[aria-selected="true"] — the keyboard's row in the caret menus. Keep aria-selected.
  itemSelected: {
    backgroundColor: colors.panelSelected,
  },
  // .menu-shortcut
  shortcut: {
    marginLeft: "auto",
    paddingLeft: "16px",
    color: colors.textTertiary,
    wordSpacing: "1px",
  },
  // .menu-separator
  separator: {
    flexShrink: 0,
    height: "1px",
    margin: "4px 0",
    backgroundColor: colors.panelBorder,
  },
  // .menu-input — a filter field at the top of a chip's menu.
  input: {
    height: "27.5px",
    margin: "0 4px 4px",
    padding: "0 8px 1px 6px",
    borderStyle: "none",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.panelBorder,
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: "transparent",
    outline: "none",
  },
});

// The top bar: 34px, with no divider; each column's top bar is its own colour, so the sidebar is one tone top to
// bottom and the main area another. Its left padding (beside the traffic lights, or not) belongs to whichever column
// it's in (Sidebar, App's main top bar, DetailsPanel).
export const topbar = stylex.create({
  // .topbar
  bar: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "2.5px",
    height: "34px",
  },
  // .topbar-button — Delta's 22px icon buttons.
  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    padding: 0,
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.textPrimary,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgTertiary,
    },
    cursor: "pointer",
    WebkitAppRegion: "no-drag",
  },
  // .notifications .topbar-button[data-open="true"] — the bell while its panel is open: add after `button`.
  buttonOpen: {
    backgroundColor: colors.bgTertiary,
  },
  // .topbar-title
  title: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.textSecondary,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  // .topbar-end — right-aligned top bar actions (the details toggle).
  end: {
    display: "flex",
    flexShrink: 0,
    gap: "2.5px",
    marginLeft: "auto",
    paddingRight: "8px",
  },
});

const toastIn = stylex.keyframes({
  from: {
    opacity: 0,
    transform: "translateY(-6px)",
  },
});

// Toasts: someone mentioned you. Top right, under the top bar, briefly. (MentionToasts; App's undo toast is its own.)
export const toast = stylex.create({
  // .toasts
  stack: {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 44px)",
    right: "14px",
    zIndex: layers.toasts,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "320px",
  },
  // .toast; add `moving` while data-moving was "true". Its transform and opacity while dragged stay inline.
  toast: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "10px 10px 10px 12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.floatBorder,
    borderRadius: radii.panel,
    backgroundColor: {
      default: colors.panel,
      ":hover": colors.panelSelected,
    },
    boxShadow: shadows.float,
    cursor: "pointer",
    touchAction: "pan-y",
    userSelect: "none",
    animationName: toastIn,
    animationDuration: "160ms",
    animationTimingFunction: "ease-out",
    // Springs back or slides away when let go; follows the finger exactly while moving.
    transitionProperty: "transform, opacity",
    transitionDuration: "180ms",
    transitionTimingFunction: "ease-out",
  },
  // .toast[data-moving="true"]
  moving: {
    transitionProperty: "none",
  },
  // .toast > .identicon — pass to Identicon's `class` (`stylex.attrs(toast.avatar).class`). Centered between the first
  // two lines: who asked and where, then what they said.
  avatar: {
    flexShrink: 0,
    marginTop: "7.5px",
  },
  // .toast-body
  body: {
    flex: 1,
    minWidth: 0,
  },
  // .toast-title
  title: {
    overflow: "hidden",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // .toast-author, .toast-thread — who and where, in the title.
  emphasis: {
    color: colors.textPrimary,
  },
  // .toast-text
  text: {
    display: "-webkit-box",
    marginTop: "2px",
    overflow: "hidden",
    color: colors.textPrimary,
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
});

// Status: a hollow ring while open, filled colors as work moves along. `stylex.attrs(status.dot, statusDot[s])` where
// `statusDot` has a style for each status that changes the ring (blocked, archived, closed); open has none:
// `stylex.attrs(status.dot, s !== "open" && statusDot[s])`.
export const status = stylex.create({
  // .status-dot
  dot: {
    flexShrink: 0,
    width: "8px",
    height: "8px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: colors.iconTertiary,
    borderRadius: "50%",
  },
  // .unread-dot — unread: a dot after the title (the indent shows the kind). Lists that also bold the title do that
  // on the title themselves.
  unread: {
    flexShrink: 0,
    width: "6px",
    height: "6px",
    marginLeft: "2px",
    borderRadius: "50%",
    backgroundColor: colors.statusWaiting,
  },
});

// .status-dot[data-status="…"]
export const statusDot = stylex.create({
  // .status-dot[data-status="blocked"] — blocked is the same red as urgent.
  blocked: {
    borderColor: colors.urgent,
    backgroundColor: colors.urgent,
  },
  // .status-dot[data-status="archived"]
  archived: {
    borderColor: colors.iconTertiary,
    backgroundColor: colors.iconTertiary,
  },
  // .status-dot[data-status="closed"]
  closed: {
    borderColor: colors.statusClosed,
    backgroundColor: colors.statusClosed,
  },
});

// Links inside text: to a person, to a thread, and @mentions.
export const link = stylex.create({
  // .person-link — a name that opens that person's profile (`PersonView`): looks like the text around it until hovered.
  // When it's also an author or a mention, put that style last so its colour and size win:
  // `stylex.attrs(link.person, thread.author)` (`.thread-author.person-link`), `stylex.attrs(link.person, link.mention)`
  // (`.mention.person-link`).
  person: {
    padding: 0,
    borderStyle: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    textDecoration: {
      default: null,
      ":hover": "underline",
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  // .org-name .person-link — a name that truncates (the org tree's rows): add after `person`.
  personTruncate: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // .mention — a mention: someone asked a question in the thread. Also on the Tiptap mention node: mentionNode.ts's
  // renderHTML takes `editorClass.mention` (below) in place of its `class: "mention"`.
  mention: {
    color: colors.accent,
  },
  // .thread-link — a link to another thread, in a message or the reply being written. Also on the Tiptap node:
  // threadLinkNode.ts's renderHTML takes `editorClass.threadLink` in place of its `class: "thread-link"`.
  thread: {
    display: "inline-flex",
    gap: "4px",
    alignItems: "center",
    maxWidth: "100%",
    height: "20px",
    margin: "0 1px",
    padding: "0 6px",
    borderStyle: "none",
    borderRadius: radii.control,
    color: colors.accent,
    font: "inherit",
    fontSize: "0.9em",
    lineHeight: "20px",
    verticalAlign: "1px",
    textDecoration: {
      default: null,
      ":hover": "underline",
    },
    backgroundColor: colors.accentFill,
    cursor: "pointer",
    userSelect: "none",
  },
  // .thread-byline .thread-link — a thread link in a byline ("Branched from"): add after `thread` (and give its icon
  // `thread.bylineIcon`).
  threadInByline: {
    height: "18px",
    fontSize: fontSizes.body,
  },
});

// Class strings for markup that isn't JSX: Tiptap's renderHTML (mentionNode.ts, threadLinkNode.ts) takes a class
// string, not StyleX objects. The nodes are found by their data attributes (`span[data-mention]`,
// `span[data-thread-link]`), so they need no hook class.
export const editorClass = {
  mention: stylex.attrs(link.mention).class ?? "",
  threadLink: stylex.attrs(link.thread).class ?? "",
};

// The bordered buttons in the compose panel's footer and a draft's actions (ComposePanel, DraftView).
export const button = stylex.create({
  // .compose-button (and :disabled); add `primary` where it had data-primary.
  button: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    height: "24px",
    padding: "0 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.button,
    color: colors.textPrimary,
    font: "inherit",
    fontSize: fontSizes.body,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgQuaternary,
    },
    cursor: {
      default: "pointer",
      ":disabled": "default",
    },
    opacity: {
      default: null,
      ":disabled": 0.5,
    },
  },
  // .compose-button[data-primary]
  primary: {
    borderColor: "transparent",
    color: colors.accent,
    backgroundColor: colors.accentFill,
  },
  // .compose-button kbd — the shortcut inside a button: put on its <kbd>.
  kbd: {
    color: colors.textTertiary,
  },
});
