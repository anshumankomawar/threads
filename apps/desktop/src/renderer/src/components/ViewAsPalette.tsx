import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { Person } from "model";
import { createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { colors } from "../styles/tokens.stylex";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// For local testing: pick who to view the app as, from the people in the current data.
export function ViewAsPalette(props: {
  onPick: (person: Person) => void;
  onClose: () => void;
}): JSX.Element {
  const app = useApp();
  let input!: HTMLInputElement;
  const [filter, setFilter] = createSignal("");
  const [selected, setSelected] = createSignal(
    untrack(() =>
      Math.max(
        0,
        app.data.people().findIndex((person) => person.id === app.me().id),
      ),
    ),
  );

  onSettled(() => input.focus());

  const options = createMemo(() => {
    const query = filter().trim().toLowerCase();
    return app.data.people().filter((person) => person.name.toLowerCase().includes(query));
  });
  const selectedIndex = (): number => Math.min(selected(), Math.max(0, options().length - 1));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = options().length;
      if (count === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex() + delta + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const person = options()[selectedIndex()];
      if (person !== undefined) props.onPick(person);
    }
  };

  return (
    <div class={sx(palette.overlay)} onMouseDown={() => props.onClose()}>
      <div
        class={sx(palette.panel)}
        role="dialog"
        aria-label="View as"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class={sx(palette.inputRow)}>
          <input
            ref={input}
            class={sx(palette.input)}
            placeholder="View as…"
            spellcheck="false"
            value={filter()}
            onInput={(event) => {
              setFilter(event.currentTarget.value);
              setSelected(0);
            }}
          />
        </div>
        <div class={sx(palette.results)}>
          <div class={sx(palette.section)}>
            <div class={sx(palette.sectionLabel)}>People</div>
            <Show when={options().length === 0}>
              <div class={sx(palette.empty)}>No matches</div>
            </Show>
            <For each={options()}>
              {(person, index) => (
                <div
                  class={sx(palette.row, index() === selectedIndex() && palette.rowSelected)}
                  role="option"
                  aria-selected={index() === selectedIndex() ? "true" : "false"}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setSelected(index())}
                  onClick={() => props.onPick(person)}
                >
                  <Identicon seed={person.id} size={16} />
                  <span class={sx(palette.rowLabel)}>{person.name}</span>
                  <Show when={person.id === app.me().id}>
                    <Icon icon={Tick02Icon} size={12} class={sx(styles.current)} />
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = stylex.create({
  // .palette-current — a tick on who you're viewing as now.
  current: {
    flexShrink: 0,
    marginLeft: "auto",
    color: colors.accent,
  },
});
