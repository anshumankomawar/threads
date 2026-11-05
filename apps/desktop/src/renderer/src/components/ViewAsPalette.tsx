import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { Person } from "model";
import { createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";

// For local testing: pick who to view the app as, from the people in the current data.
export function ViewAsPalette(props: {
  people: Person[];
  me: Person;
  onPick: (person: Person) => void;
  onClose: () => void;
}): JSX.Element {
  let input!: HTMLInputElement;
  const [filter, setFilter] = createSignal("");
  const [selected, setSelected] = createSignal(
    untrack(() =>
      Math.max(
        0,
        props.people.findIndex((person) => person.id === props.me.id),
      ),
    ),
  );

  onSettled(() => input.focus());

  const options = createMemo(() => {
    const query = filter().trim().toLowerCase();
    return props.people.filter((person) => person.name.toLowerCase().includes(query));
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
    <div class="palette-overlay" onMouseDown={() => props.onClose()}>
      <div
        class="palette"
        role="dialog"
        aria-label="View as"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="palette-input-row">
          <input
            ref={input}
            class="palette-input"
            placeholder="View as…"
            spellcheck="false"
            value={filter()}
            onInput={(event) => {
              setFilter(event.currentTarget.value);
              setSelected(0);
            }}
          />
        </div>
        <div class="palette-results">
          <div class="palette-section">
            <div class="palette-section-label">People</div>
            <Show when={options().length === 0}>
              <div class="palette-empty">No matches</div>
            </Show>
            <For each={options()}>
              {(person, index) => (
                <div
                  class="palette-row"
                  data-selected={String(index() === selectedIndex())}
                  role="option"
                  aria-selected={index() === selectedIndex() ? "true" : "false"}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setSelected(index())}
                  onClick={() => props.onPick(person)}
                >
                  <Identicon seed={person.id} size={16} />
                  <span class="palette-row-label">{person.name}</span>
                  <Show when={person.id === props.me.id}>
                    <Icon icon={Tick02Icon} size={12} class="palette-current" />
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
