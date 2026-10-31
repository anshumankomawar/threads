import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { Person } from "model";
import { Identicon } from "./Identicon";

// For local testing: pick who to view the app as, from the people in the current data.
export function ViewAsPalette({
  people,
  me,
  onPick,
  onClose,
}: {
  people: Person[];
  me: Person;
  onPick: (person: Person) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(() =>
    Math.max(
      0,
      people.findIndex((person) => person.id === me.id),
    ),
  );

  useEffect(() => inputRef.current?.focus(), []);

  const query = filter.trim().toLowerCase();
  const options = people.filter((person) => person.name.toLowerCase().includes(query));
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + delta + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const person = options[selectedIndex];
      if (person !== undefined) onPick(person);
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="View as"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="View as…"
            spellCheck={false}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setSelected(0);
            }}
          />
        </div>
        <div className="palette-results">
          <div className="palette-section">
            <div className="palette-section-label">People</div>
            {options.length === 0 && <div className="palette-empty">No matches</div>}
            {options.map((person, index) => (
              <div
                key={person.id}
                className="palette-row"
                data-selected={index === selectedIndex}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setSelected(index)}
                onClick={() => onPick(person)}
              >
                <Identicon seed={person.id} size={16} />
                <span className="palette-row-label">{person.name}</span>
                {person.id === me.id && (
                  <Check size={12} strokeWidth={2.2} className="palette-current" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
