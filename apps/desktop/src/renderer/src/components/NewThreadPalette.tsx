import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { labelSlug, type Label, type Person } from "model";
import { Identicon } from "./Identicon";

export type NewThreadDraft = {
  title: string;
  // Empty for none.
  description: string;
  // Who it's assigned to: someone, or nobody (then it's your own to-do until you @mention someone).
  assignees: Person[];
  // Its labels by name; any that don't exist yet are made with it.
  labelNames: string[];
};

// `labels` is a detour from the last step, for filing it.
type Step = "write" | "describe" | "pick" | "labels";

// A title, then an optional description, then who it's for.
const STEPS: Step[] = ["write", "describe", "pick"];

type Option = { id: string; label: string; hint?: string; person?: Person; value: Person | null };

// Starting a thread step by step: write its title, describe it if you like, then choose who it's assigned to. On that
// step, Tab picks its labels. You own it; it lands in their inbox, sorted into one of their buckets.
export function NewThreadPalette({
  people,
  me,
  labels,
  initialLabels,
  initialAssignee = null,
  onCreate,
  onClose,
}: {
  people: Person[];
  me: Person;
  // The labels on offer.
  labels: Label[];
  // What it starts with, such as the group you're making it in.
  initialLabels: Label[];
  // Who it's for, first in the list, such as whoever's profile you're making it from.
  initialAssignee?: Person | null;
  onCreate: (draft: NewThreadDraft) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("write");
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [chosenLabels, setChosenLabels] = useState<{ id: string; name: string }[]>(initialLabels);

  useEffect(() => inputRef.current?.focus(), []);

  const others = people.filter((person) => person.id !== me.id);
  const query = filter.trim().toLowerCase();
  const everyone: Option[] = others.map((person) => ({
    id: person.id,
    label: person.name,
    person,
    value: person,
  }));
  const pickOptions: Option[] = [
    { id: "unassigned", label: "Unassigned", value: null },
    ...everyone,
    { id: me.id, label: "Me", person: me, value: me },
  ].toSorted((a, b) => Number(b.id === initialAssignee?.id) - Number(a.id === initialAssignee?.id));
  const matches = (label: string): boolean => label.toLowerCase().includes(query);
  const newLabel = labelSlug(filter);
  const labelOptions: Option[] = [
    ...labels
      .filter((label) => matches(label.name))
      .map((label) => ({ id: label.id, label: label.name, value: null })),
    ...(newLabel !== "" &&
    !labels.some((label) => label.id === newLabel || labelSlug(label.name) === newLabel)
      ? [{ id: newLabel, label: `Make “${filter.trim()}”`, hint: filter.trim(), value: null }]
      : []),
  ];
  const options =
    step === "labels" ? labelOptions : pickOptions.filter((option) => matches(option.label));
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));
  const title = text.trim();

  const focusInput = (): void => inputRef.current?.focus();

  const goTo = (next: Step): void => {
    setStep(next);
    setFilter("");
    setSelected(0);
    focusInput();
  };

  const forward = (): void => {
    if (title.length === 0) return focusInput();
    goTo(STEPS[STEPS.indexOf(step) + 1] ?? step);
  };

  const back = (): void =>
    goTo(step === "labels" ? "pick" : (STEPS[STEPS.indexOf(step) - 1] ?? "write"));

  const hasLabel = (id: string): boolean => chosenLabels.some((label) => label.id === id);
  // Adds or removes a label, including one that doesn't exist yet, which is made along with the thread.
  const toggleLabel = (option: Option | undefined): void => {
    if (option === undefined) return;
    const name = option.hint ?? option.label;
    setChosenLabels((current) =>
      hasLabel(option.id)
        ? current.filter((label) => label.id !== option.id)
        : [...current, { id: option.id, name }],
    );
    setFilter("");
    setSelected(0);
    focusInput();
  };

  const create = (option: Option | undefined): void => {
    if (option === undefined) return;
    onCreate({
      title,
      description: description.trim(),
      assignees: option.value === null ? [] : [option.value],
      labelNames: chosenLabels.map((label) => label.name),
    });
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (step === "write") onClose();
      else back();
      return;
    }
    if (step === "write" || step === "describe") {
      if (event.key === "Enter") {
        event.preventDefault();
        forward();
      } else if (
        step === "describe" &&
        event.key === "Backspace" &&
        description === "" &&
        !event.repeat
      ) {
        event.preventDefault();
        back();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + delta + options.length) % options.length);
    } else if (event.key === "Backspace" && filter.length === 0) {
      // Holding Backspace clears the filter and stops there; a fresh press on the empty field steps back.
      event.preventDefault();
      if (!event.repeat) back();
    } else if (step === "labels") {
      if (event.key === "Enter") {
        event.preventDefault();
        toggleLabel(options[selectedIndex]);
      }
    } else if (event.key === "Tab") {
      event.preventDefault();
      goTo("labels");
    } else if (event.key === "Enter") {
      event.preventDefault();
      create(options[selectedIndex]);
    }
  };

  const placeholder =
    step === "write"
      ? "What do you need?"
      : step === "describe"
        ? "Add a description… (optional)"
        : step === "labels"
          ? "Find or make a label…"
          : "Assign to…";
  const summary = step === "describe" ? "Describe" : step === "labels" ? "Label" : "Assign";
  const nextLabel =
    title.length === 0
      ? "Write what you need to continue"
      : step === "write"
        ? "Continue to describe"
        : "Continue to assign";

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="New thread"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input-row">
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={placeholder}
            spellCheck={false}
            value={step === "write" ? text : step === "describe" ? description : filter}
            onChange={(event) => {
              if (step === "write") setText(event.target.value);
              else if (step === "describe") setDescription(event.target.value);
              else {
                setFilter(event.target.value);
                setSelected(0);
              }
            }}
          />
          <span className="palette-step">
            Step {STEPS.indexOf(step === "labels" ? "pick" : step) + 1} of {STEPS.length}
          </span>
        </div>
        <div className="palette-results">
          {step === "write" || step === "describe" ? (
            <div className="palette-section">
              <div className="palette-section-label palette-summary">
                {step === "write" ? (
                  "Next"
                ) : (
                  <>
                    {summary} <span className="palette-summary-title">“{title}”</span>
                  </>
                )}
              </div>
              <div
                className="palette-row"
                data-selected={title.length > 0}
                data-disabled={title.length === 0}
                role="option"
                aria-selected={title.length > 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={forward}
              >
                <span className="palette-row-label">{nextLabel}</span>
                <span className="palette-row-shortcut">↵</span>
              </div>
            </div>
          ) : (
            <div className="palette-section">
              <div className="palette-section-label palette-summary">
                {summary} <span className="palette-summary-title">“{title}”</span>
                {step === "pick" ? " to" : ""}
                {step === "pick" && (
                  <button
                    type="button"
                    className="palette-side"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => goTo("labels")}
                  >
                    {chosenLabels.length === 0
                      ? "No labels"
                      : chosenLabels.length === 1
                        ? chosenLabels[0].name
                        : `${chosenLabels[0].name} +${chosenLabels.length - 1}`}
                    <span className="palette-row-shortcut">⇥</span>
                  </button>
                )}
              </div>
              {options.length === 0 && <div className="palette-empty">No matches</div>}
              {options.map((option, index) => {
                const checked = step === "labels" && hasLabel(option.id);
                return (
                  <div
                    key={option.id}
                    className="palette-row"
                    data-selected={index === selectedIndex}
                    role="option"
                    aria-selected={step === "labels" ? checked : index === selectedIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => (step === "labels" ? toggleLabel(option) : create(option))}
                  >
                    {option.person !== undefined && <Identicon seed={option.person.id} size={16} />}
                    <span className="palette-row-label">{option.label}</span>
                    {step === "labels" && (
                      <span className="palette-check" data-checked={checked} aria-hidden>
                        {checked && <HugeiconsIcon icon={Tick02Icon} size={12} />}
                      </span>
                    )}
                  </div>
                );
              })}
              {step === "labels" && (
                <div
                  className="palette-row palette-continue"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={back}
                >
                  <span className="palette-row-label">Done</span>
                  <span className="palette-row-shortcut">esc</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
