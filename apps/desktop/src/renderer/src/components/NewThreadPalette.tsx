import { useEffect, useRef, useState } from "react";
import { formatClock, startOfDay, DAY } from "../format";
import { Check } from "lucide-react";
import type { Person, Schedule, ThreadKind } from "../model";
import { Identicon } from "./Identicon";

export type NewThreadDraft = {
  kind: ThreadKind;
  text: string;
  assignee: Person | null;
  // People invited to a meeting, besides you.
  invitees: Person[];
  schedule: Schedule | null;
};

type Step = "write" | "invite" | "pick";

// A thread is written then assigned; a meeting is written, gets invitees, then a time; focus work is written
// then scheduled.
function stepsFor(kind: ThreadKind): Step[] {
  return kind === "meeting" ? ["write", "invite", "pick"] : ["write", "pick"];
}

const TABS: { kind: ThreadKind; label: string; shortcut: string }[] = [
  { kind: "response", label: "Thread", shortcut: "⌘ 1" },
  { kind: "meeting", label: "Meeting", shortcut: "⌘ 2" },
  { kind: "focus", label: "Focus", shortcut: "⌘ 3" },
];

const PLACEHOLDERS: Record<ThreadKind, string> = {
  response: "What do you need?",
  meeting: "What's the meeting about?",
  focus: "What are you working on?",
};

type Option = {
  id: string;
  label: string;
  hint?: string;
  person?: Person;
  value: Person | Schedule | null;
};

// When it can happen: each remaining hour today (9 to 6), tomorrow morning, and for focus work, no time yet.
function whenOptions(kind: ThreadKind, nowMs: number): Option[] {
  const lengthMs = (kind === "focus" ? 60 : 30) * 60_000;
  const at = (dayOffset: number, hour: number): Schedule => {
    const date = new Date(startOfDay(nowMs) + dayOffset * DAY);
    date.setHours(hour, 0, 0, 0);
    return { startMs: date.getTime(), endMs: date.getTime() + lengthMs };
  };
  const firstHour = Math.max(9, new Date(nowMs).getHours() + 1);
  const today = Array.from({ length: Math.max(0, 19 - firstHour) }, (_, i) => at(0, firstHour + i));
  const options: Option[] = [
    ...today.map((schedule) => ({
      id: `today-${schedule.startMs}`,
      label: `Today, ${formatClock(schedule.startMs)}`,
      hint: `${lengthMs / 60_000} min`,
      value: schedule,
    })),
    { id: "tomorrow", label: `Tomorrow, ${formatClock(at(1, 10).startMs)}`, value: at(1, 10) },
  ];
  return kind === "focus"
    ? [{ id: "none", label: "Not scheduled", value: null }, ...options]
    : options;
}

// Starting a thread step by step: write the opening message and pick the kind, invite people (meetings only),
// then choose who it's for (a thread) or when it happens (a meeting or focus block).
export function NewThreadPalette({
  initialKind,
  people,
  me,
  nowMs,
  onCreate,
  onClose,
}: {
  initialKind: ThreadKind;
  people: Person[];
  me: Person;
  nowMs: number;
  onCreate: (draft: NewThreadDraft) => void;
  onClose: () => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(initialKind);
  const [step, setStep] = useState<Step>("write");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const [invitees, setInvitees] = useState<Person[]>([]);

  useEffect(() => inputRef.current?.focus(), []);

  const steps = stepsFor(kind);
  const others = people.filter((person) => person.id !== me.id);
  const query = filter.trim().toLowerCase();
  const matches = (label: string): boolean => label.toLowerCase().includes(query);

  const pickOptions: Option[] =
    kind === "response"
      ? [
          { id: "unassigned", label: "Unassigned", value: null },
          ...others.map((person) => ({ id: person.id, label: person.name, person, value: person })),
          { id: me.id, label: "Me", person: me, value: me },
        ]
      : whenOptions(kind, nowMs);
  const inviteOptions: Option[] = others.map((person) => ({
    id: person.id,
    label: person.name,
    person,
    value: person,
  }));
  const options = (step === "invite" ? inviteOptions : pickOptions).filter((option) =>
    matches(option.label),
  );
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));
  const title = text.trim().split("\n")[0];
  const isInvited = (person: Person): boolean =>
    invitees.some((invitee) => invitee.id === person.id);

  const focusInput = (): void => inputRef.current?.focus();

  const goTo = (next: Step): void => {
    setStep(next);
    setFilter("");
    setSelected(0);
    focusInput();
  };

  const changeKind = (next: ThreadKind): void => {
    setKind(next);
    // Stay put if the new kind has this step; otherwise drop back to writing.
    goTo(stepsFor(next).includes(step) ? step : "write");
  };

  const forward = (): void => {
    if (text.trim().length === 0) {
      focusInput();
      return;
    }
    goTo(steps[steps.indexOf(step) + 1] ?? step);
  };

  const back = (): void => goTo(steps[steps.indexOf(step) - 1] ?? "write");

  const toggleInvitee = (person: Person): void =>
    setInvitees((current) =>
      current.some((invitee) => invitee.id === person.id)
        ? current.filter((invitee) => invitee.id !== person.id)
        : [...current, person],
    );

  const create = (option: Option | undefined): void => {
    if (option === undefined) return;
    onCreate({
      kind,
      text: text.trim(),
      assignee: kind === "response" ? (option.value as Person | null) : null,
      invitees: kind === "meeting" ? invitees : [],
      schedule: kind === "response" ? null : (option.value as Schedule | null),
    });
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (step === "write") onClose();
      else back();
      return;
    }
    if (event.metaKey && ["1", "2", "3"].includes(event.key)) {
      event.preventDefault();
      changeKind(TABS[Number(event.key) - 1].kind);
      return;
    }
    if (step === "write") {
      if (event.key === "Enter") {
        event.preventDefault();
        forward();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelected((selectedIndex + delta + options.length) % options.length);
    } else if (event.key === "Backspace" && filter.length === 0) {
      event.preventDefault();
      back();
    } else if (step === "invite") {
      const option = options[selectedIndex];
      // Space toggles the highlighted person, Enter moves on to picking a time.
      if (event.key === " " && option?.person !== undefined) {
        event.preventDefault();
        toggleInvitee(option.person);
      } else if (event.key === "Enter") {
        event.preventDefault();
        forward();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      create(options[selectedIndex]);
    }
  };

  const placeholder =
    step === "write"
      ? PLACEHOLDERS[kind]
      : step === "invite"
        ? "Invite people…"
        : kind === "response"
          ? "Assign to…"
          : "When…";
  const summary = step === "invite" ? "Invite to" : kind === "response" ? "Assign" : "Schedule";
  const nextLabel = (): string => {
    if (text.trim().length === 0) {
      const what =
        kind === "response" ? "what you need" : kind === "meeting" ? "what it's about" : "the work";
      return `Write ${what} to continue`;
    }
    const nextStep = steps[steps.indexOf(step) + 1];
    return nextStep === "invite"
      ? "Continue to invite"
      : kind === "response"
        ? "Continue to assign"
        : "Continue to schedule";
  };

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
            value={step === "write" ? text : filter}
            onChange={(event) => {
              if (step === "write") setText(event.target.value);
              else {
                setFilter(event.target.value);
                setSelected(0);
              }
            }}
          />
          <span className="palette-step">
            Step {steps.indexOf(step) + 1} of {steps.length}
          </span>
        </div>
        <div className="palette-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              className="palette-tab"
              aria-selected={kind === tab.kind}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => changeKind(tab.kind)}
            >
              <span>{tab.label}</span>
              <span className="palette-tab-shortcut">{tab.shortcut}</span>
            </button>
          ))}
        </div>
        <div className="palette-results">
          {step === "write" ? (
            <div className="palette-section">
              <div className="palette-section-label">Next</div>
              <div
                className="palette-row"
                data-selected={text.trim().length > 0}
                data-disabled={text.trim().length === 0}
                role="option"
                aria-selected={text.trim().length > 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={forward}
              >
                <span className="palette-row-label">{nextLabel()}</span>
                <span className="palette-row-shortcut">↵</span>
              </div>
            </div>
          ) : (
            <div className="palette-section">
              <div className="palette-section-label palette-summary">
                {summary} <span className="palette-summary-title">“{title}”</span>
                {step === "pick" && kind === "response" ? " to" : ""}
                {step === "invite" && (
                  <span className="palette-summary-count">
                    {invitees.length === 0 ? "Just you so far" : `You + ${invitees.length}`}
                  </span>
                )}
              </div>
              {options.length === 0 && <div className="palette-empty">No matches</div>}
              {options.map((option, index) => {
                const invited =
                  step === "invite" && option.person !== undefined && isInvited(option.person);
                return (
                  <div
                    key={option.id}
                    className="palette-row"
                    data-selected={index === selectedIndex}
                    role="option"
                    aria-selected={step === "invite" ? invited : index === selectedIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => {
                      if (step === "invite" && option.person !== undefined)
                        toggleInvitee(option.person);
                      else create(option);
                    }}
                  >
                    {option.person !== undefined && <Identicon seed={option.person.id} size={16} />}
                    <span className="palette-row-label">{option.label}</span>
                    {step === "invite" ? (
                      <span className="palette-check" data-checked={invited} aria-hidden>
                        {invited && <Check size={12} strokeWidth={2.2} />}
                      </span>
                    ) : (
                      option.hint !== undefined && (
                        <span className="palette-row-shortcut">{option.hint}</span>
                      )
                    )}
                  </div>
                );
              })}
              {step === "invite" && (
                <div
                  className="palette-row palette-continue"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={forward}
                >
                  <span className="palette-row-label">Continue to schedule</span>
                  <span className="palette-row-shortcut">↵</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
