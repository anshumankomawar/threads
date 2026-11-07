import * as i from "@hugeicons/core-free-icons";
import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { menu, setMenu, type MenuItem } from "../session";
import { base } from "../styles/base";
import { chip, chipTone, menu as look } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes } from "../styles/tokens.stylex";
import { icon, type IconSvgElement } from "./Icon";
import { Identicon } from "./Identicon";
import { holdFocus, menuLeaving } from "./InlineForm";

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
// `leftward`, as a menu hanging from a toolbar's right end: its submenus open to the left.
function Items(props: { items: MenuItem[]; close: () => void; leftward?: boolean }): JSX.Element {
  // A menu where no row has an icon (or a check) has no icon column at all.
  const gutter = (): boolean =>
    props.items.some(
      (item) => item !== "separator" && (item.icon !== undefined || "checked" in item),
    );
  const [sub, setSub] = createSignal<{
    item: MenuItem & { items: MenuItem[] };
    row: DOMRect;
  } | null>(null);
  // A submenu opens once for its row: coming back to the row (or clicking it) keeps the one that's open rather than
  // drawing it again.
  const openSub = (item: MenuItem & { items: MenuItem[] }, event: Event): void => {
    if (untrack(sub)?.item === item) return;
    setSub({ item, row: (event.currentTarget as HTMLElement).getBoundingClientRect() });
  };
  const row = (
    item: Exclude<MenuItem, "separator">,
    run: ((from: DOMRect) => void) | undefined,
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
        onPointerEnter={(event) => (opens ? openSub(item, event) : setSub(null))}
        onClick={(event) => {
          const entry = event.currentTarget as HTMLElement;
          if (opens) return openSub(item, event);
          // Kept a moment, in case what it runs grows a form out of it (InlineForm), which then fades in over it.
          const menu = entry.closest<HTMLElement>("[role=menu]");
          if (menu) menuLeaving(menu);
          run?.((entry.querySelector("svg") ?? entry).getBoundingClientRect());
        }}
      >
        <Show when={gutter()}>
          <span class={sx(look.entryIcon)}>{checked ? icon(i.Tick02Icon, 13) : item.icon}</span>
        </Show>
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
      const left = at.left - width - 4;
      panel.style.left = `${
        props.leftward
          ? left >= 4
            ? left
            : right
          : right + width > innerWidth - 4
            ? Math.max(4, left)
            : right
      }px`;
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
            row(item, (from) => (props.close(), item.run(from)))
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
            <Items items={open.item.items} close={props.close} leftward={props.leftward} />
          </div>
        )}
      </Show>
    </>
  );
}

// The right-click menu, at the pointer and kept on screen. A popover: a click elsewhere or Escape closes it.
export function ContextMenu(): JSX.Element {
  const show = (el: HTMLDivElement, at: { x: number; y: number; end?: boolean }): void => {
    el.showPopover();
    const { width, height } = el.getBoundingClientRect();
    const left = at.end ? at.x - width : at.x;
    el.style.left = `${Math.max(4, Math.min(left, innerWidth - width - 4))}px`;
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
          <Items items={shown.items} close={() => setMenu(null)} leftward={shown.end} />
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

// Under its button, the right edges level, growing left over the page (StyleX's types only know the plain areas).
const UNDER_END = "bottom span-left" as "bottom";
const combo = stylex.create({
  panel: {
    width: 220,
    minWidth: 0,
    marginTop: 4,
    positionArea: UNDER_END,
    positionTryFallbacks: "flip-block",
  },
  // What you type, as a row of the menu itself: a field in the first entry's place.
  field: { cursor: "text" },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: fontSizes.body,
    outline: "none",
    "::placeholder": { color: colors.textTertiary },
  },
  list: { display: "flex", flexDirection: "column" },
  empty: { color: colors.textTertiary, cursor: "default" },
});

// A button that opens a combo box under it, the size of a context menu: a field to narrow the choices, then the choices,
// which the arrow keys move through and Enter picks, closing it. A click picks and leaves it open for another, as adding
// several people at once does; Escape or a click elsewhere closes it.
export function ComboButton(props: {
  label: JSX.Element;
  class: string;
  placeholder: string;
  empty: string;
  options: (query: string) => Option[];
}): JSX.Element {
  const id = createUniqueId();
  const [query, setQuery] = createSignal("");
  const [at, setAt] = createSignal(0);
  let input!: HTMLInputElement;
  const shown = (): Option[] => props.options(query().trim().toLowerCase());
  const index = (): number => Math.min(at(), shown().length - 1);
  let panel!: HTMLDivElement;
  // A click picks and stays open for another; Enter picks and is done.
  const pick = (option: Option | undefined, done = false): void => {
    if (!option) return;
    option.run();
    setQuery("");
    if (done) panel.hidePopover();
    else input.focus();
  };
  return (
    <>
      <button popovertarget={id} class={props.class}>
        {props.label}
      </button>
      <div
        id={id}
        ref={(el) => (holdFocus(el), (panel = el))}
        popover="auto"
        class={sx(base.panel, look.menu, look.compact, look.popover, combo.panel)}
        role="dialog"
        onToggle={(event) => {
          if (event.newState !== "open") return;
          setQuery("");
          setAt(0);
          input.focus();
        }}
      >
        <label class={sx(look.entry, look.entryOpen, combo.field)}>
          <span class={sx(look.entryIcon)}>{icon(i.Search01Icon, 12)}</span>
          <input
            ref={input}
            class={sx(base.bare, combo.input)}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            placeholder={props.placeholder}
            spellcheck={false}
            value={query()}
            onInput={(event) => (setQuery(event.currentTarget.value), setAt(0))}
            onKeyDown={(event) => {
              const next = moved(event.key, index(), shown().length);
              if (next !== undefined) setAt(next);
              else if (event.key === "Enter" && !event.isComposing) pick(shown()[index()], true);
              else return;
              event.preventDefault();
            }}
          />
        </label>
        <hr class={sx(look.entrySeparator)} />
        <div id={`${id}-list`} class={sx(combo.list)} role="listbox">
          <For
            each={shown()}
            fallback={<div class={sx(look.entry, combo.empty)}>{props.empty}</div>}
          >
            {(option, n) => (
              <button
                class={sx(base.bare, look.entry, n() === index() && look.entryOpen)}
                role="option"
                aria-selected={n() === index() ? "true" : "false"}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setAt(n())}
                onClick={() => pick(option)}
              >
                <span class={sx(look.entryIcon)}>
                  <Show when={option.seed} fallback={option.icon && icon(option.icon, 13)}>
                    {(seed) => <Identicon seed={seed()} size={14} />}
                  </Show>
                </span>
                <span class={sx(base.ellipsis, look.entryLabel)}>{option.label}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </>
  );
}
