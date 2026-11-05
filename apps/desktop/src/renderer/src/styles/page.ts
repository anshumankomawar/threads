import * as stylex from "@stylexjs/stylex";
import { colors, contentZoom, fontSizes, radii } from "./tokens.stylex";

// List pages: a group's or label's page (LabelView), a sprint's (SprintView), a person's (PersonView), the thread lists
// on them (ThreadItems), and the headings ProfileView and SettingsView share with them. Apply with
// `{...stylex.attrs(page.page, page.groupPage)}`. Page-specific parts (LabelView's title editing and members, the
// group's activity, the sprint's dates and load, the org tree) stay with their component. No element here needs a
// plain hook class: nothing selects them from JS.
export const page = stylex.create({
  // .list-page — Tracking and Not scheduled pages, laid out like Organization. The main content zooms on its own (⌘+,
  // ⌘-, ⌘0); the sidebar, top bar and palettes keep their size.
  page: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    padding: "52px 15px 48px 52px",
    overflowY: "auto",
    zoom: contentZoom["--content-zoom"],
  },
  // .list-page-title, .org-title — a page's title (the org, profile and settings pages' `.org-title` is the same).
  title: {
    margin: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.pageTitle,
    fontWeight: 600,
    lineHeight: "28px",
    letterSpacing: "-0.2px",
  },
  // .list-page-summary, .org-summary — the line under a title (the same rule under both names).
  summary: {
    margin: "2px 0 0",
    color: colors.textTertiary,
  },
  // .group-page .list-page-summary svg — the icon in a group or label page's summary (main.css's `.group-page` was on
  // LabelView's, SprintView's and PersonView's pages); put it on the Icon.
  summaryIcon: {
    verticalAlign: "-1px",
  },
  // .profile-heading — a section heading on a profile or settings page.
  heading: {
    margin: "32px 0 0",
    color: colors.textPrimary,
    fontSize: fontSizes.input,
    fontWeight: 600,
  },

  // A list of threads (ThreadItems, PersonView): an icon, the title with its unread dot, why it's here, and a date.
  // .list-page-items; on a group-style page (`.group-page .list-page-items`, every page that uses it today) add
  // itemsInGroupPage after it.
  items: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    maxWidth: "640px",
    margin: "20px 0 0 -8px",
    padding: 0,
    listStyle: "none",
  },
  // .group-page .list-page-items
  itemsInGroupPage: {
    marginTop: "12px",
  },
  // .list-page-item
  item: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    width: "100%",
    padding: "8px",
    borderStyle: "none",
    borderRadius: radii.item,
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgQuaternary,
    },
    cursor: "pointer",
  },
  // .list-page-icon
  itemIcon: {
    display: "flex",
    marginTop: "3px",
    color: colors.iconTertiary,
  },
  // .list-page-body
  itemBody: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  // .list-page-name
  itemName: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    color: colors.textPrimary,
  },
  // .list-page-reason
  itemReason: {
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  // .list-page-meta; add itemMetaOverdue when data-overdue was "true".
  itemMeta: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },
  // .list-page-meta[data-overdue="true"]
  itemMetaOverdue: {
    color: colors.urgent,
  },

  // A group or label's page: built on the list page, with its members, its actions and a row of filters.
  // .group-actions
  actions: {
    display: "flex",
    gap: "12px",
    marginTop: "10px",
  },
  // .group-action
  action: {
    padding: 0,
    borderStyle: "none",
    color: {
      default: colors.textTertiary,
      ":hover": colors.textPrimary,
    },
    font: "inherit",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  // .group-toolbar — New thread, the list/board toggle and the filter chips.
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    alignItems: "center",
    maxWidth: "640px",
    marginTop: "22px",
  },
  // .group-new
  newButton: {
    height: "24px",
    padding: "0 9px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.strokeFocused,
    borderRadius: radii.button,
    color: colors.textPrimary,
    font: "inherit",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.bgTertiary,
    },
    cursor: "pointer",
  },
  // .group-filters
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
    marginLeft: "auto",
  },
  // .group-empty
  empty: {
    margin: "16px 0 0",
    color: colors.textTertiary,
  },
  // .group-heading
  groupHeading: {
    margin: "28px 0 8px",
    color: colors.textSecondary,
    fontSize: fontSizes.body,
    fontWeight: 500,
  },

  // Facts about a person, sprint or you: label on the left, value beside it.
  // .profile-facts; put factsTerm on each dt and factsValue on each dd. On a person's page (`.person-page
  // .profile-facts`) add factsNarrow after it.
  facts: {
    display: "grid",
    // The same label column as the settings below.
    gridTemplateColumns: "120px 1fr",
    gap: "6px 20px",
    margin: "20px 0 0",
  },
  // .person-page .profile-facts
  factsNarrow: {
    maxWidth: "640px",
  },
  // .profile-facts dt
  factsTerm: {
    color: colors.textTertiary,
  },
  // .profile-facts dd
  factsValue: {
    margin: 0,
    color: colors.textPrimary,
  },
});
