import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { Person } from "model";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { menu } from "../styles/controls";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// A keyboard-navigable list: which item is selected, clamped to what's there.
export function createList<T>(compute: () => T[], initial = 0) {
  const items = createMemo(compute);
  const [selected, setSelected] = createSignal(initial);
  const index = (): number => Math.min(selected(), Math.max(0, items().length - 1));
  const set = (at: number): void => void setSelected(at);
  const move = (by: number): void => set((index() + by + items().length) % (items().length || 1));
  return { items, index, set, move, current: (): T | undefined => items()[index()] };
}
export type List<T> = ReturnType<typeof createList<T>>;

export const matching = (name: string, filter: string): boolean =>
  name.toLowerCase().includes(filter.trim().toLowerCase());
export const others = (people: Person[], me: Person): Person[] =>
  people.filter((person) => person.id !== me.id);

export const Quoted = (props: { children: JSX.Element }): JSX.Element => (
  <span class={sx(palette.quoted)}>“{props.children}”</span>
);

// The overlay and floating panel; clicking outside calls onClose.
export function Shell(props: {
  label: string;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  style?: stylex.StyleXStyles;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class={sx(palette.overlay)} onMouseDown={() => props.onClose()}>
      <div
        class={sx(menu.menu, palette.panel, palette.centered, props.style)}
        role="dialog"
        aria-label={props.label}
        onKeyDown={(event) => props.onKeyDown(event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  );
}

// `checked` adds a check box, and is then what aria-selected says.
type Spec = {
  label: JSX.Element;
  seed?: string;
  shortcut?: string;
  checked?: boolean;
  tick?: boolean;
};
type RowProps = { spec: Spec; selected: boolean; disabled?: boolean; more?: boolean };

export function Row(props: RowProps & { onHover?: () => void; onClick: () => void }): JSX.Element {
  const spec = createMemo(() => props.spec);
  const checked = (): boolean | undefined => spec().checked;
  const box = (): string =>
    sx(palette.check, palette.checkBox, checked() === true && palette.checked);
  return (
    <div
      class={sx(
        menu.item,
        props.selected && menu.itemSelected,
        props.disabled === true && palette.rowDisabled,
        props.more === true && palette.more,
      )}
      role="option"
      aria-selected={(checked() ?? props.selected) ? "true" : "false"}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => props.onHover?.()}
      onClick={() => props.onClick()}
    >
      <Show when={spec().seed}>{(seed) => <Identicon seed={seed()} size={16} />}</Show>
      <span class={sx(palette.rowLabel)}>{spec().label}</span>
      <Show when={spec().shortcut}>
        {(key) => <span class={sx(palette.shortcut)}>{key()}</span>}
      </Show>
      <Show when={checked() !== undefined}>
        <span class={box()} aria-hidden="true">
          <Show when={checked()}>
            <Icon icon={Tick02Icon} size={12} />
          </Show>
        </span>
      </Show>
      <Show when={spec().tick}>
        <Icon icon={Tick02Icon} size={12} class={sx(palette.tick)} />
      </Show>
    </div>
  );
}

type At<T> = { item: T; at: number };

// The list's rows (or some of them, with where each is in the list).
export function Rows<T>(props: {
  list: List<T>;
  row: (item: T) => Spec;
  onPick: (item: T) => void;
  rows?: At<T>[];
}): JSX.Element {
  const rows = (): At<T>[] => props.rows ?? props.list.items().map((item, at) => ({ item, at }));
  return (
    <For each={rows()}>
      {(row) => (
        <Row
          spec={props.row(row.item)}
          selected={props.list.index() === row.at}
          onHover={() => props.list.set(row.at)}
          onClick={() => props.onPick(row.item)}
        />
      )}
    </For>
  );
}

// An input, then the list's rows (in sections by `group`, or one under `section`), then `next` (the row Enter takes
// when there's no list, enabled when `ready`) and `children`. Arrows move through the list and Enter picks; Escape
// and Backspace on an empty input go back, or Escape closes. `onKey` sees keys first: true when it took one.
export function Palette<T>(props: {
  label: string;
  placeholder: string;
  value: string;
  onInput: (value: string) => void;
  onClose: () => void;
  onBack?: () => void;
  onEnter?: () => void;
  onKey?: (event: KeyboardEvent) => boolean;
  list?: List<T>;
  row?: (item: T) => Spec;
  group?: (item: T) => string;
  onPick?: (item: T) => void;
  section?: JSX.Element;
  next?: string;
  ready?: boolean;
  step?: string;
  maxlength?: number;
  chip?: JSX.Element;
  tabs?: JSX.Element;
  children?: JSX.Element;
}): JSX.Element {
  let input!: HTMLInputElement;
  onSettled(() => input.focus());
  const pick = (item: T | undefined): void => void (item !== undefined && props.onPick?.(item));
  const onKeyDown = (event: KeyboardEvent): void => {
    const { key } = event;
    const list = props.list;
    const arrow = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
    const back = key === "Escape" || (key === "Backspace" && props.value === "");
    if (props.onKey?.(event) === true) event.preventDefault();
    else if (list !== undefined && arrow !== 0) list.move(arrow);
    else if (key === "Enter" && list === undefined) props.onEnter?.();
    else if (key === "Enter") pick(list?.current());
    else if (back && (props.onBack !== undefined || key === "Escape")) {
      if (!event.repeat) (props.onBack ?? props.onClose)();
    } else return;
    event.preventDefault();
  };
  const sections = createMemo(() => {
    const out: { title?: string; rows: At<T>[] }[] = [];
    (props.list?.items() ?? []).forEach((item, at) => {
      const title = props.group?.(item);
      if (out.length === 0 || out.at(-1)?.title !== title) out.push({ title, rows: [] });
      out.at(-1)?.rows.push({ item, at });
    });
    return out.length === 0 && props.group === undefined ? [{ rows: [] }] : out;
  });
  return (
    <Shell label={props.label} onClose={props.onClose} onKeyDown={onKeyDown}>
      <div class={sx(palette.inputRow)}>
        {props.chip}
        <input
          ref={input}
          class={sx(palette.input)}
          placeholder={props.placeholder}
          spellcheck="false"
          maxlength={props.maxlength}
          value={props.value}
          onInput={(event) => {
            props.onInput(event.currentTarget.value);
            props.list?.set(0);
          }}
        />
        <Show when={props.step}>{(step) => <span class={sx(palette.step)}>{step()}</span>}</Show>
      </div>
      {props.tabs}
      <div class={sx(palette.results)}>
        <For each={sections()}>
          {(section, index) => (
            <div {...stylex.attrs(palette.section, palette.divided, paletteSectionMarker)}>
              <Show when={section.title ?? props.section}>
                {(label) => (
                  <div class={sx(palette.sectionLabel, palette.labelText)}>{label()}</div>
                )}
              </Show>
              <Show when={props.list?.items().length === 0}>
                <div class={sx(palette.empty)}>No matches</div>
              </Show>
              <Show when={props.list}>
                {(list) => (
                  <Rows list={list()} row={props.row!} onPick={pick} rows={section.rows} />
                )}
              </Show>
              <Show when={index() === sections().length - 1}>
                <Show when={props.list === undefined && props.next}>
                  {(next) => (
                    <Row
                      spec={{ label: next(), shortcut: "↵" }}
                      selected={props.ready === true}
                      disabled={props.ready !== true}
                      onClick={() => props.onEnter?.()}
                    />
                  )}
                </Show>
                {props.children}
              </Show>
            </div>
          )}
        </For>
      </div>
    </Shell>
  );
}
