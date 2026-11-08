import * as i from "@hugeicons/core-free-icons";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { setDialog, setSidebarOpen, sidebarOpen } from "../session";
import { base } from "../styles/base";
import { topbar } from "../styles/controls";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { sx } from "../styles/sx";
import { Icon, type IconSvgElement } from "./Icon";

// The top bars' shared controls, laid out as the macOS app's toolbar: the sidebar's button beside the window's
// buttons, and a search field at the far end.

const s = stylex.create({
  // A field that opens search (⌘K): rounded, its magnifier and placeholder quiet, its key at the end.
  search: {
    display: "flex",
    flexShrink: 1,
    gap: 6,
    alignItems: "center",
    width: 220,
    minWidth: 120,
    height: 24,
    padding: "0 10px",
    borderRadius: radii.pill,
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    backgroundColor: { default: colors.bgQuaternary, ":hover": colors.bgTertiary },
    cursor: "text",
    WebkitAppRegion: "no-drag",
  },
  searchKey: { marginLeft: "auto" },
});

// Hugeicons' panel icon with the side pane tinted, for a sidebar that's open: it reads as open without being the
// darkest thing in the bar.
const LEFT_PANE =
  "M9 3H8C6 3 4.9 3.2 4.17 4.17C3.2 4.9 3 6 3 8V16C3 18 3.2 19.1 4.17 19.83C4.9 20.8 6 21 8 21H9Z";
const sidebarIcon = (open: boolean): IconSvgElement =>
  open
    ? [
        ...i.PanelLeftIcon,
        ["path", { d: LEFT_PANE, fill: "currentColor", fillOpacity: 0.3, key: "pane" }],
      ]
    : i.PanelLeftIcon;

const TopButton = (props: {
  label: string;
  icon: IconSvgElement;
  onClick: () => void;
}): JSX.Element => (
  <button
    class={sx(topbar.button)}
    aria-label={props.label}
    title={props.label}
    onClick={() => props.onClick()}
  >
    <Icon icon={props.icon} size={14} aria-hidden="true" />
  </button>
);

// Beside the window's buttons: on the sidebar's top row, or the list's while it's hidden.
export const AppButtons = (): JSX.Element => (
  <TopButton
    label={sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
    icon={sidebarIcon(sidebarOpen())}
    onClick={() => setSidebarOpen(!sidebarOpen())}
  />
);

// At the far end of the top bar: a field that opens search.
export const SearchField = (): JSX.Element => (
  <button
    class={sx(base.bare, s.search)}
    aria-label="Search"
    title="Search (⌘K)"
    onClick={() => setDialog({ kind: "search" })}
  >
    <Icon icon={i.Search01Icon} size={13} aria-hidden="true" />
    Search
    <span class={sx(s.searchKey)}>⌘K</span>
  </button>
);
