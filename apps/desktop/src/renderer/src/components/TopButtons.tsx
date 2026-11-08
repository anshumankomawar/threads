import * as i from "@hugeicons/core-free-icons";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled } from "solid-js";
import { setDialog, setSidebarOpen, sidebarOpen } from "../session";
import { topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { Icon, type IconSvgElement } from "./Icon";

// The top bars' shared controls, as an iOS app's toolbar: the sidebar's round beside the window's buttons, and pills
// of buttons that spring to fit what's in them.

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
    <Icon icon={props.icon} size={15} aria-hidden="true" />
  </button>
);

// Beside the window's buttons: on the sidebar's top row, or the list's while it's hidden.
export const AppButtons = (): JSX.Element => (
  <TopButton
    label={sidebarOpen() ? "Hide sidebar" : "Show sidebar"}
    icon={i.PanelLeftIcon}
    onClick={() => setSidebarOpen(!sidebarOpen())}
  />
);

// Buttons that belong together in one pill, as wide as what's in it: when that changes (a thread's actions coming in),
// it springs to the new width, and what's new comes in out of a blur. `content` names what's in it; a new name is new
// content.
export function Pill(props: { content: string; children: JSX.Element }): JSX.Element {
  const [width, setWidth] = createSignal<number>();
  let inner!: HTMLSpanElement;
  onSettled(() => {
    const sizes = new ResizeObserver(() => setWidth(inner.offsetWidth));
    sizes.observe(inner);
    return () => sizes.disconnect();
  });
  return (
    <span
      class={sx(topbar.group)}
      style={{ width: width() === undefined ? undefined : `${width()}px` }}
    >
      <span ref={inner} class={sx(topbar.groupInner)}>
        {/* Made again when `content` changes, so it comes in anew. */}
        <For each={[props.content]}>
          {() => <span class={sx(topbar.groupContent, topbar.enter)}>{props.children}</span>}
        </For>
      </span>
    </span>
  );
}

// Search (⌘K), as a button in a pill.
export const SearchButton = (): JSX.Element => (
  <button
    class={sx(topbar.groupButton)}
    aria-label="Search"
    title="Search (⌘K)"
    onClick={() => setDialog({ kind: "search" })}
  >
    <Icon icon={i.Search01Icon} size={15.4} aria-hidden="true" />
  </button>
);
