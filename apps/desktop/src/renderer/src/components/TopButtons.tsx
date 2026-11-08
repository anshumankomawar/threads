import * as i from "@hugeicons/core-free-icons";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  setDialog,
  setSidebarOpen,
  sidebarOpen,
} from "../session";
import { topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { Icon, type IconSvgElement } from "./Icon";

// The buttons in the top bars: showing the sidebar and searching, beside the window's buttons; and back and forward,
// before the reading pane's title.

const s = stylex.create({
  history: { display: "flex", marginRight: 6 },
  // Narrower, to sit tight against its neighbour.
  tight: { width: 18 },
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
  disabled?: boolean;
  tight?: boolean;
  onClick: () => void;
}): JSX.Element => (
  <button
    class={sx(topbar.button, props.tight && s.tight)}
    aria-label={props.label}
    title={props.label}
    disabled={props.disabled}
    onClick={() => props.onClick()}
  >
    <Icon icon={props.icon} size={14} aria-hidden="true" />
  </button>
);

// Beside the window's buttons: on the sidebar's top row, or the list's while it's hidden.
export const AppButtons = (): JSX.Element => (
  <>
    <TopButton
      label={sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
      icon={sidebarIcon(sidebarOpen())}
      onClick={() => setSidebarOpen(!sidebarOpen())}
    />
    <TopButton label="Search" icon={i.Search01Icon} onClick={() => setDialog({ kind: "search" })} />
  </>
);

// Back and forward through the pages you've opened, side by side before the reading pane's title.
export const HistoryButtons = (): JSX.Element => (
  <span class={sx(s.history)}>
    <TopButton
      label="Back (⌘[)"
      icon={i.ArrowLeft01Icon}
      tight
      disabled={!canGoBack()}
      onClick={goBack}
    />
    <TopButton
      label="Forward (⌘])"
      icon={i.ArrowRight01Icon}
      tight
      disabled={!canGoForward()}
      onClick={goForward}
    />
  </span>
);
