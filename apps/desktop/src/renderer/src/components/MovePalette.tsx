import { useEffect, useRef, useState } from "react";
import { useThreadLinks } from "../threadLinks";

export type MoveTarget = { kind: "thread"; threadId: string } | { kind: "new"; title: string };

const MATCHES = 8;

// Picks where selected messages go: a new thread (titled by what you type, or by the first message) or an existing
// one. With nothing typed, a new thread comes first; once you type, matching threads do.
export function MovePalette({
  count,
  fromThreadId,
  linkedThreadIds,
  suggestedTitle,
  onMove,
  onClose,
}: {
  count: number;
  fromThreadId: string;
  // Threads the messages link to: they're the way into those threads from here, so they stay put.
  linkedThreadIds: string[];
  suggestedTitle: string;
  onMove: (target: MoveTarget) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const { search } = useThreadLinks();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  useEffect(() => inputRef.current?.focus(), []);

  const typed = query.trim();
  type Item = { id: string; label: string; target: MoveTarget };
  const threads = search(typed)
    .filter((thread) => thread.id !== fromThreadId && !linkedThreadIds.includes(thread.id))
    .slice(0, MATCHES)
    .map<Item>((thread) => ({
      id: thread.id,
      label: thread.title,
      target: { kind: "thread", threadId: thread.id },
    }));
  const exact = threads.some((thread) => thread.label.toLowerCase() === typed.toLowerCase());
  const create: Item = {
    id: "new",
    label: typed || suggestedTitle,
    target: { kind: "new", title: typed || suggestedTitle },
  };
  const items = typed.length === 0 ? [create, ...threads] : exact ? threads : [...threads, create];
  const selectedIndex = Math.min(selected, items.length - 1);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[selectedIndex];
      if (item !== undefined) onMove(item.target);
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Move messages"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={`Move ${count === 1 ? "message" : `${count} messages`} to…`}
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
          />
        </div>
        <div className="palette-results">
          <div className="palette-section">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="palette-row"
                data-selected={index === selectedIndex}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseMove={() => setSelected(index)}
                onClick={() => onMove(item.target)}
              >
                <span className="palette-row-label">
                  {item.target.kind === "new" ? (
                    <>
                      New thread <span className="palette-summary-title">“{item.label}”</span>
                    </>
                  ) : (
                    item.label
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
