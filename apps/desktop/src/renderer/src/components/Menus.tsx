import * as i from "@hugeicons/core-free-icons";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { menu, setMenu, type MenuItem } from "../session";
import { base } from "../styles/base";
import { chip, chipTone, menu as look } from "../styles/controls";
import { sx } from "../styles/sx";
import { icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";

// One choice in a list you move through with the arrow keys: a palette's rows, the reply's @ # / menus, ⌘⇧N's @ menu.
// `section` heads a run of a palette's rows; `hint` sits on the right; `accent` makes it stand out ("New thread").
export type Option = {
  label: string;
  hint?: string;
  seed?: string;
  icon?: IconSvgElement;
  accent?: boolean;
  section?: string;
  run: () => void;
};

// Where the arrow keys move the choice to in a list of `count`, wrapping; undefined for any other key.
export const moved = (key: string, at: number, count: number): number | undefined =>
  key === "ArrowDown" ? (at + 1) % count : key === "ArrowUp" ? (at - 1 + count) % count : undefined;

// An option as a row: someone's avatar or an icon, its label, its hint. It doesn't take the focus from what you type.
export function OptionButton(props: {
  option: Option;
  selected: boolean;
  onHover: () => void;
}): JSX.Element {
  const o = (): Option => props.option;
  return (
    <button
      class={sx(base.bare, look.item, props.selected && look.itemSelected)}
      role="option"
      aria-selected={props.selected ? "true" : "false"}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => props.onHover()}
      onClick={() => o().run()}
    >
      <Show
        when={o().seed}
        fallback={
          <Show when={o().icon}>
            {(svg) => <span class={sx(look.itemIcon)}>{icon(svg(), 13)}</span>}
          </Show>
        }
      >
        {(seed) => <Identicon seed={seed()} size={16} />}
      </Show>
      <span class={sx(base.ellipsis, look.label)}>{o().label}</span>
      <Show when={o().hint}>
        <span class={sx(look.hint, o().accent && look.accent)}>{o().hint}</span>
      </Show>
    </button>
  );
}

// A menu's rows. One with `items` shows them in its place, under a row back.
function Items(props: { items: MenuItem[]; close: () => void }): JSX.Element {
  const [sub, setSub] = createSignal<{ label: string; items: MenuItem[] } | null>(null);
  const row = (
    label: string,
    before: JSX.Element | undefined,
    run: () => void,
    checked?: boolean,
  ): JSX.Element => (
    <button
      class={sx(base.bare, look.item, look.itemHover)}
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked === undefined ? undefined : checked ? "true" : "false"}
      onClick={run}
    >
      <Show when={before}>
        <span class={sx(look.itemIcon)}>{before}</span>
      </Show>
      <span class={sx(base.ellipsis, look.label)}>{label}</span>
      <Show when={checked}>
        <span class={sx(look.itemIcon)}>{icon(i.Tick02Icon, 13)}</span>
      </Show>
    </button>
  );
  return (
    <>
      <Show when={sub()}>
        {(open) => (
          <>
            {row(open().label, icon(i.ArrowLeft01Icon), () => setSub(null))}
            <hr class={sx(look.separator)} />
          </>
        )}
      </Show>
      <For each={sub()?.items ?? props.items}>
        {(item) =>
          item === "separator" ? (
            <hr class={sx(look.separator)} />
          ) : "items" in item ? (
            row(item.label, item.icon, () => setSub(item))
          ) : item.checked !== undefined ? (
            row(item.label, item.icon, item.run, item.checked)
          ) : (
            row(item.label, item.icon, () => (props.close(), item.run()))
          )
        }
      </For>
    </>
  );
}

// The right-click menu, at the pointer and kept on screen. A popover: a click elsewhere or Escape closes it.
export function ContextMenu(): JSX.Element {
  const show = (el: HTMLDivElement, at: { x: number; y: number }): void => {
    el.showPopover();
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(at.x, innerWidth - width - 4))}px`;
    el.style.top = `${at.y + height > innerHeight - 4 ? Math.max(4, at.y - height) : at.y}px`;
  };
  return (
    <Show when={menu()} keyed>
      {(shown) => (
        <div
          popover="auto"
          ref={(el) => queueMicrotask(() => show(el, shown))}
          onToggle={(event) => event.newState === "closed" && menu() === shown && setMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
          class={sx(base.panel, look.menu, look.popover, look.context)}
          style={{ left: `${shown.x}px`, top: `${shown.y}px` }}
          role="menu"
        >
          <Items items={shown.items} close={() => setMenu(null)} />
        </div>
      )}
    </Show>
  );
}

// A chip that opens a menu of choices under it (the popover's implicit anchor is the chip that targets it).
export function MenuChip(props: {
  label: JSX.Element;
  icon?: JSX.Element;
  tone?: "urgent" | "muted";
  title?: string;
  // In place of the chip's look, as for an icon button.
  look?: stylex.StyleXStyles;
  items: MenuItem[];
}): JSX.Element {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let popover!: HTMLDivElement;
  return (
    <>
      <button
        popovertarget={id}
        title={props.title}
        aria-label={props.title}
        class={sx(
          props.look ?? [base.hover, chip.chip],
          open() && chip.open,
          props.tone && chipTone[props.tone],
        )}
      >
        {props.icon}
        {props.label}
      </button>
      <div
        id={id}
        ref={popover}
        popover="auto"
        onToggle={(event) => setOpen(event.newState === "open")}
        class={sx(base.panel, look.menu, look.popover, chip.menu)}
        role="menu"
      >
        {/* Mounted while open, so it opens at the top level again. */}
        <Show when={open()}>
          <Items items={props.items} close={() => popover.hidePopover()} />
        </Show>
      </div>
    </>
  );
}
