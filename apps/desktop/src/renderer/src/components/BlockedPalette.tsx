import type { Person } from "model";
import { useEffect, useRef, useState } from "react";
import { Identicon } from "./Identicon";

type Step = "who" | "what" | "why";

// `/blocked` in a reply, in three steps: who you're blocked on (you, for something you'll sort out yourself), what
// you need from them (the new thread's title), and why it's blocking (its description; optional). It becomes a new
// thread asking them, and the thread you're in waits until it's closed. Backspace on an empty field goes back a step.
export function BlockedPalette({
  people,
  me,
  blockedTitle,
  onCreate,
  onClose,
}: {
  people: Person[];
  me: Person;
  // The thread that's blocked, for the prompt.
  blockedTitle: string;
  // The new thread's opening message: the title, then the reason on the lines after it.
  onCreate: (person: Person, text: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("who");
  const [person, setPerson] = useState<Person | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState(0);
  useEffect(() => inputRef.current?.focus(), [step]);

  const query = text.trim().toLowerCase();
  // Everyone else, then you.
  const options =
    step === "who"
      ? [...people.filter((candidate) => candidate.id !== me.id), me].filter((candidate) =>
          candidate.name.toLowerCase().includes(query),
        )
      : [];
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));
  const isMe = person?.id === me.id;
  const firstName = person?.name.split(" ")[0];

  const goTo = (next: Step, value = ""): void => {
    setStep(next);
    setText(value);
    setSelected(0);
  };
  const pick = (chosen: Person): void => {
    setPerson(chosen);
    goTo("what", title);
  };
  const next = (): void => {
    if (step === "what" && text.trim().length > 0) {
      setTitle(text.trim());
      goTo("why");
    } else if (step === "why" && person !== null) {
      const reason = text.trim();
      onCreate(person, reason.length > 0 ? `${title}\n${reason}` : title);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (step === "who" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      if (options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + delta + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (step === "who") {
        if (options[selectedIndex] !== undefined) pick(options[selectedIndex]);
      } else next();
    } else if (event.key === "Backspace" && step !== "who" && text === "" && !event.repeat) {
      event.preventDefault();
      if (step === "why") goTo("what", title);
      else goTo("who");
    }
  };

  const placeholder =
    step === "who"
      ? "Blocked on who?"
      : step === "what"
        ? isMe
          ? "What do you need to sort out?"
          : `What do you need from ${firstName}?`
        : "Why is it blocking? (optional)";
  const action =
    step === "what"
      ? "Next: why it's blocking"
      : isMe
        ? "Start a thread for it"
        : `Ask ${firstName} in a new thread`;
  const ready = step === "why" || text.trim().length > 0;

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Blocked on someone"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          {person !== null && step !== "who" && (
            <span className="palette-chip">
              <Identicon seed={person.id} size={14} />
              {isMe ? "Me" : person.name}
            </span>
          )}
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={placeholder}
            spellCheck={false}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSelected(0);
            }}
          />
        </div>
        <div className="palette-results">
          <div className="palette-section">
            <div className="palette-section-label palette-summary">
              {step === "why" ? (
                <>
                  Asking for <span className="palette-summary-title">“{title}”</span>
                </>
              ) : (
                <>
                  Blocking <span className="palette-summary-title">“{blockedTitle}”</span>
                </>
              )}
            </div>
            {step === "who" ? (
              options.map((candidate, index) => (
                <div
                  key={candidate.id}
                  className="palette-row"
                  data-selected={index === selectedIndex}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => pick(candidate)}
                >
                  <Identicon seed={candidate.id} size={16} />
                  <span className="palette-row-label">
                    {candidate.id === me.id ? "Me" : candidate.name}
                  </span>
                </div>
              ))
            ) : (
              <div
                className="palette-row"
                data-selected={ready}
                data-disabled={!ready}
                role="option"
                aria-selected={ready}
                onClick={next}
              >
                <span className="palette-row-label">{action}</span>
                <span className="palette-row-shortcut">↵</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
