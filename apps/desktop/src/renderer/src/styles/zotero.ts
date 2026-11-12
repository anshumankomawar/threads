import * as stylex from "@stylexjs/stylex";
import { zTreeMarker } from "./markers.stylex";
import { colors, fontSizes, zotero } from "./tokens.stylex";

// What Zotero 7's panes share (zotero/zotero scss/components/_toolbar.scss, _toolbarbutton.scss,
// _virtualized-table.scss), in our StyleX. Each size is Zotero's CSS pixels ÷ 1.1, for the window's 110%.
export const z = stylex.create({
  // .toolbar: 41px tall, 8px in from its ends. A drag region (macOS: -moz-window-dragging: drag).
  toolbar: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    height: zotero.toolbar,
    paddingInline: zotero.xs,
    minWidth: 0,
  },
  // The items pane's toolbar (#zotero-layout-switcher .zotero-toolbar): --material-toolbar over a pane divider.
  toolbarItems: {
    backgroundColor: colors.zToolbar,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.zPanedivider,
  },
  // The collections pane's: on the side pane, its bottom border transparent.
  toolbarCollections: {
    backgroundColor: colors.zSidepane,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
  },
  // toolbarbutton: 28 × 28, 4px in, rounded 5px, --fill-secondary, a quinary fill under the pointer and a quarternary
  // one while pressed.
  button: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: zotero.button,
    height: zotero.button,
    paddingBlock: 0,
    paddingInline: zotero.min,
    margin: 0,
    borderStyle: "none",
    borderRadius: zotero.radius,
    color: { default: colors.zFillSecondary, ":disabled": colors.zFillTertiary },
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": colors.zFillQuinary,
      ":active:not(:disabled)": colors.zFillQuarternary,
    },
    cursor: "default",
    WebkitAppRegion: "no-drag",
  },
  // The items toolbar's buttons are 4px apart on each side.
  buttonSpaced: { marginInline: zotero.min },
  buttonFirst: { marginInlineStart: 0 },
  // .zotero-tb-separator: a pane divider 36px tall.
  separator: {
    width: 0,
    height: "32.73px",
    marginInline: zotero.min,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.zPanedivider,
  },
  spacer: { flex: 1, minWidth: 0, alignSelf: "stretch" },
  // A tree's row (.virtualized-table .row): 28px, rounded 5px, 13px text.
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: zotero.row,
    borderRadius: zotero.radius,
    color: colors.zFillPrimary,
    fontSize: fontSizes.body,
    lineHeight: zotero.lineHeight,
    whiteSpace: "nowrap",
    cursor: "default",
    outline: "none",
  },
  // .row.selected: the accent in white while its tree has focus; --color-quarternary-on-sidepane in --fill-primary
  // when it hasn't.
  rowSelected: {
    color: {
      default: colors.zFillPrimary,
      [stylex.when.ancestor(":focus-within", zTreeMarker)]: colors.zAccentText,
    },
    backgroundColor: {
      default: colors.zQuarternaryOnSidepane,
      [stylex.when.ancestor(":focus-within", zTreeMarker)]: colors.zAccent,
    },
  },
  // .row.unread.
  unread: { fontWeight: 600 },
  // A row's 16px icon, in --fill-secondary (white on a focused selection, as Zotero swaps its icons to white/).
  rowIcon: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: zotero.icon,
    height: zotero.icon,
    color: colors.zFillSecondary,
  },
  rowIconSelected: {
    color: {
      default: colors.zFillSecondary,
      [stylex.when.ancestor(":focus-within", zTreeMarker)]: colors.zAccentText,
    },
  },
  // .spacer-twisty / .twisty: 16px; the twisty a chevron pointing down when open, turned -90° when closed.
  twisty: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: zotero.icon,
    height: zotero.icon,
    color: colors.zFillSecondary,
    transitionProperty: "transform",
    transitionDuration: "0.125s",
    transitionTimingFunction: "ease",
  },
  twistyClosed: { transform: "rotate(-90deg)" },
  // .cell-text: after the icon, 4px on.
  cellText: {
    flexShrink: 1,
    minWidth: 0,
    marginLeft: zotero.min,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});
