import { CircleSlash, X } from "lucide-react";
import type { Person } from "model";
import { useEffect, useRef, useState } from "react";
import { Identicon } from "./Identicon";

const ICON_PROPS = { size: 13, strokeWidth: 1.7, "aria-hidden": true } as const;

// `/blocked`, in place of the reply: who you're blocked on, then what you need from them. Enter makes it a new thread
// asking them, which blocks this one; Backspace on an empty message goes back to choosing who; Escape returns to the
// reply.
export function BlockedForm({
  people,
  me,
  onCreate,
  onCancel,
}: {
  people: Person[];
  me: Person;
  onCreate: (person: Person, text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState(0);
  useEffect(() => inputRef.current?.focus(), [person]);

  const query = text.trim().toLowerCase();
  // Everyone else, then you, for something you'll sort out yourself.
  const options =
    person === null
      ? [...people.filter((candidate) => candidate.id !== me.id), me].filter((candidate) =>
          candidate.name.toLowerCase().includes(query),
        )
      : [];
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));
  const firstName = person?.name.split(" ")[0];

  const pick = (chosen: Person): void => {
    setPerson(chosen);
    setText("");
  };
  const submit = (): void => {
    if (person !== null && text.trim().length > 0) onCreate(person, text.trim());
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (person === null && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (person !== null) submit();
      else if (options[selectedIndex] !== undefined) pick(options[selectedIndex]);
    } else if (event.key === "Backspace" && person !== null && text === "" && !event.repeat) {
      event.preventDefault();
      setPerson(null);
    }
  };

  return (
    <div className="thread-block blocked-form" onKeyDown={onKeyDown}>
      <span className="thread-avatar blocked-form-marker" aria-hidden>
        <CircleSlash size={12} strokeWidth={2} />
      </span>
      <div className="thread-body">
        <div className="thread-meta">
          <span className="thread-author">Blocked on</span>
          {person !== null && (
            <span className="blocked-form-person">
              <Identicon seed={person.id} size={14} />
              {person.name}
              <button
                type="button"
                className="blocked-form-clear"
                aria-label="Choose someone else"
                onClick={() => setPerson(null)}
              >
                <X size={11} strokeWidth={2} aria-hidden />
              </button>
            </span>
          )}
          <span className="thread-time">
            {person === null
              ? "↑↓ to choose · Esc to cancel"
              : `↵ to ask ${firstName} · Esc to cancel`}
          </span>
        </div>
        <input
          ref={inputRef}
          className="thread-text blocked-form-input"
          placeholder={person === null ? "Who?" : `What do you need from ${firstName}?`}
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSelected(0);
          }}
        />
        {person === null && options.length > 0 && (
          <div className="blocked-form-people" role="listbox" aria-label="People">
            {options.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className="blocked-form-option"
                onMouseEnter={() => setSelected(index)}
                onClick={() => pick(candidate)}
              >
                <Identicon seed={candidate.id} size={16} />
                {candidate.name}
              </button>
            ))}
          </div>
        )}
        {person !== null && (
          <div className="blocked-form-note">
            <CircleSlash {...ICON_PROPS} />
            Starts a thread asking {firstName}; this one waits until it's closed.
          </div>
        )}
      </div>
    </div>
  );
}
