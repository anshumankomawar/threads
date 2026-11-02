import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { labelSlug, type Label, type Person } from "model";
import { useEffect, useRef, useState } from "react";
import { Identicon } from "./Identicon";

// Making a group: name it, then pick anyone in the organization to include. You're in it either way, and more people
// can join later.
export function NewGroupPalette({
  people,
  me,
  labels,
  onCreate,
  onClose,
}: {
  people: Person[];
  me: Person;
  labels: Label[];
  onCreate: (name: string, members: Person[]) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"name" | "members">("name");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [members, setMembers] = useState<Person[]>([]);

  useEffect(() => inputRef.current?.focus(), []);

  const title = name.trim();
  const slug = labelSlug(title);
  const taken = labels.some((label) => label.id === slug || labelSlug(label.name) === slug);
  const canContinue = slug !== "" && !taken;
  const query = filter.trim().toLowerCase();
  const options = people.filter(
    (person) => person.id !== me.id && person.name.toLowerCase().includes(query),
  );
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));
  const isIn = (person: Person): boolean => members.some((member) => member.id === person.id);
  const toggle = (person: Person): void =>
    setMembers((current) =>
      isIn(person) ? current.filter((member) => member.id !== person.id) : [...current, person],
    );
  const toMembers = (): void => {
    if (!canContinue) return;
    setStep("members");
    setFilter("");
    setSelected(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (step === "name") onClose();
      else setStep("name");
      return;
    }
    if (step === "name") {
      if (event.key === "Enter") {
        event.preventDefault();
        toMembers();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + delta + options.length) % options.length);
    } else if (event.key === " ") {
      event.preventDefault();
      const person = options[selectedIndex];
      if (person !== undefined) toggle(person);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onCreate(title, members);
    } else if (event.key === "Backspace" && filter === "" && !event.repeat) {
      event.preventDefault();
      setStep("name");
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="New group"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={
              step === "name" ? "Name the group: a project, program or team" : "Add people…"
            }
            spellCheck={false}
            maxLength={80}
            value={step === "name" ? name : filter}
            onChange={(event) => {
              if (step === "name") setName(event.target.value);
              else {
                setFilter(event.target.value);
                setSelected(0);
              }
            }}
          />
          <span className="palette-step">Step {step === "name" ? 1 : 2} of 2</span>
        </div>
        <div className="palette-results">
          {step === "name" ? (
            <div className="palette-section">
              <div className="palette-section-label">Next</div>
              <div
                className="palette-row"
                data-selected={canContinue}
                data-disabled={!canContinue}
                role="option"
                aria-selected={canContinue}
                onMouseDown={(event) => event.preventDefault()}
                onClick={toMembers}
              >
                <span className="palette-row-label">
                  {taken
                    ? `“${title}” is taken in your organization`
                    : slug === ""
                      ? "Type a name to continue"
                      : "Continue to add people"}
                </span>
                {canContinue && <span className="palette-row-shortcut">↵</span>}
              </div>
            </div>
          ) : (
            <div className="palette-section">
              <div className="palette-section-label palette-summary">
                Add people to <span className="palette-summary-title">“{title}”</span>
                <span className="palette-summary-count">
                  {members.length === 0 ? "Just you so far" : `You + ${members.length}`}
                </span>
              </div>
              {options.length === 0 && <div className="palette-empty">No matches</div>}
              {options.map((person, index) => (
                <div
                  key={person.id}
                  className="palette-row"
                  data-selected={index === selectedIndex}
                  role="option"
                  aria-selected={isIn(person)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => toggle(person)}
                >
                  <Identicon seed={person.id} size={16} />
                  <span className="palette-row-label">{person.name}</span>
                  <span className="palette-check" data-checked={isIn(person)} aria-hidden>
                    {isIn(person) && <HugeiconsIcon icon={Tick02Icon} size={12} />}
                  </span>
                </div>
              ))}
              <div
                className="palette-row palette-continue"
                role="option"
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onCreate(title, members)}
              >
                <span className="palette-row-label">Create the group</span>
                <span className="palette-row-shortcut">↵</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
