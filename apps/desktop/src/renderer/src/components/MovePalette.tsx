import { createMemo, createSignal, For, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useApp } from "../app/state";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";

export type MoveTarget = { kind: "thread"; threadId: string } | { kind: "new"; title: string };

const MATCHES = 8;

// Picks where selected messages go: a new thread (titled by what you type, or by the first message) or an existing
// one. With nothing typed, a new thread comes first; once you type, matching threads do.
export function MovePalette(props: {
  count: number;
  fromThreadId: string;
  // Threads the messages link to: they're the way into those threads from here, so they stay put.
  linkedThreadIds: string[];
  suggestedTitle: string;
  onMove: (target: MoveTarget) => void;
  onClose: () => void;
}): JSX.Element {
  let input!: HTMLInputElement;
  const app = useApp();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  onSettled(() => input.focus());

  type Item = { id: string; label: string; target: MoveTarget };
  const items = createMemo((): Item[] => {
    const typed = query().trim();
    const threads = app.links
      .search(typed)
      .filter(
        (thread) => thread.id !== props.fromThreadId && !props.linkedThreadIds.includes(thread.id),
      )
      .slice(0, MATCHES)
      .map<Item>((thread) => ({
        id: thread.id,
        label: thread.title,
        target: { kind: "thread", threadId: thread.id },
      }));
    const exact = threads.some((thread) => thread.label.toLowerCase() === typed.toLowerCase());
    const create: Item = {
      id: "new",
      label: typed || props.suggestedTitle,
      target: { kind: "new", title: typed || props.suggestedTitle },
    };
    return typed.length === 0 ? [create, ...threads] : exact ? threads : [...threads, create];
  });
  const selectedIndex = (): number => Math.min(selected(), items().length - 1);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = items().length;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex() + step + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items()[selectedIndex()];
      if (item !== undefined) props.onMove(item.target);
    }
  };

  return (
    <div class={sx(palette.overlay)} onMouseDown={() => props.onClose()}>
      <div
        class={sx(palette.panel)}
        role="dialog"
        aria-label="Move messages"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class={sx(palette.inputRow)}>
          <input
            ref={input}
            class={sx(palette.input)}
            placeholder={`Move ${props.count === 1 ? "message" : `${props.count} messages`} to…`}
            spellcheck="false"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setSelected(0);
            }}
          />
        </div>
        <div class={sx(palette.results)}>
          <div class={sx(palette.section)}>
            <For each={items()}>
              {(item, index) => (
                <div
                  class={sx(palette.row, index() === selectedIndex() && palette.rowSelected)}
                  role="option"
                  aria-selected={index() === selectedIndex() ? "true" : "false"}
                  onMouseMove={() => setSelected(index())}
                  onClick={() => props.onMove(item.target)}
                >
                  <span class={sx(palette.rowLabel)}>
                    {item.target.kind === "new" ? (
                      <>
                        New thread <span class={sx(palette.summaryTitle)}>“{item.label}”</span>
                      </>
                    ) : (
                      item.label
                    )}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
