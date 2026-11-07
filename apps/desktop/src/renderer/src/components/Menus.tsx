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

// A menu's rows, as macOS lays them out: an icon column (a toggle's check goes there too), titles in one column after it,
// and a chevron on a row with `items`, whose submenu opens beside it while you're on it.
function Items(props: { items: MenuItem[]; close: () => void }): JSX.Element {
  const [sub, setSub] = createSignal<{
    item: MenuItem & { items: MenuItem[] };
    row: DOMRect;
  } | null>(null);
  const row = (
    item: Exclude<MenuItem, "separator">,
    run: (() => void) | undefined,
    checked?: boolean,
  ): JSX.Element => {
    const opens = "items" in item;
    return (
      <button
        class={sx(base.bare, look.entry, sub()?.item === item && look.entryOpen)}
        role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
        aria-checked={checked === undefined ? undefined : checked ? "true" : "false"}
        aria-haspopup={opens ? "menu" : undefined}
        aria-expanded={opens ? (sub()?.item === item ? "true" : "false") : undefined}
        onPointerEnter={(event) =>
          setSub(
            opens
              ? { item, row: (event.currentTarget as HTMLElement).getBoundingClientRect() }
              : null,
          )
        }
        onClick={(event) =>
          opens
            ? setSub({ item, row: (event.currentTarget as HTMLElement).getBoundingClientRect() })
            : run?.()
        }
      >
        <span class={sx(look.entryIcon)}>{checked ? icon(i.Tick02Icon, 13) : item.icon}</span>
        <span class={sx(base.ellipsis, look.entryLabel)}>{item.label}</span>
        <Show when={opens}>
          <span class={sx(look.entryChevron)}>{icon(i.ArrowRight01Icon, 11)}</span>
        </Show>
      </button>
    );
  };
  // A submenu beside its row, its first row level with it; on the left if there's no room on the right.
  const place = (panel: HTMLDivElement, at: DOMRect): void => {
    queueMicrotask(() => {
      const { width, height } = panel.getBoundingClientRect();
      const right = at.right + 4;
      panel.style.left = `${right + width > innerWidth - 4 ? Math.max(4, at.left - width - 4) : right}px`;
      panel.style.top = `${Math.max(4, Math.min(at.top - 4.5, innerHeight - height - 4))}px`;
    });
  };
  return (
    <>
      <For each={props.items}>
        {(item) =>
          item === "separator" ? (
            <hr class={sx(look.entrySeparator)} />
          ) : "items" in item ? (
            row(item, undefined)
          ) : item.checked !== undefined ? (
            row(item, item.run, item.checked)
          ) : (
            row(item, () => (props.close(), item.run()))
          )
        }
      </For>
      <Show when={sub()} keyed>
        {(open) => (
          <div
            ref={(panel) => place(panel, open.row)}
            class={sx(base.panel, look.menu, look.compact, look.submenu)}
            style={{ left: `${open.row.right + 4}px`, top: `${open.row.top - 4.5}px` }}
            role="menu"
          >
            <Items items={open.item.items} close={props.close} />
          </div>
        )}
      </Show>
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
          class={sx(base.panel, look.menu, look.compact, look.popover, look.context)}
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
        class={sx(base.panel, look.menu, look.compact, look.popover, chip.menu)}
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
