import { useEffect, useRef, useState } from "react";
import { formatClock, formatWhen, parseWhen, startOfDay, DAY } from "../format";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import type { Person, Schedule, ThreadKind } from "model";
import { Identicon } from "./Identicon";

// What the form makes; conversations start from a mention in a reply instead.
export type NewThreadKind = Exclude<ThreadKind, "conversation">;

export type NewThreadDraft = {
  kind: NewThreadKind;
  title: string;
  // Empty for none.
  description: string;
  assignee: Person | null;
  // People invited to a meeting, besides you.
  invitees: Person[];
  schedule: Schedule | null;
};

type Step = "write" | "describe" | "invite" | "pick";

// Every kind gets a title then an optional description. Then a thread is assigned; a meeting gets invitees, then a
// time; focus work is scheduled.
function stepsFor(kind: NewThreadKind): Step[] {
  return kind === "meeting"
    ? ["write", "describe", "invite", "pick"]
    : ["write", "describe", "pick"];
}

const TABS: { kind: NewThreadKind; label: string; shortcut: string }[] = [
  { kind: "response", label: "Thread", shortcut: "⌘ 1" },
  { kind: "meeting", label: "Meeting", shortcut: "⌘ 2" },
  { kind: "focus", label: "Focus", shortcut: "⌘ 3" },
];

const PLACEHOLDERS: Record<NewThreadKind, string> = {
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
function whenOptions(kind: NewThreadKind, nowMs: number): Option[] {
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

// Starting a thread step by step: write its title and pick the kind, describe it if you like, invite people (meetings
// only), then choose who it's for (a thread) or when it happens (a meeting or focus block).
export function NewThreadPalette({
  initialKind,
  people,
  me,
  nowMs,
  onCreate,
  onClose,
}: {
  initialKind: NewThreadKind;
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
  const [description, setDescription] = useState("");
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
  // A time typed in words ("fri 3pm", "tomorrow 10:30 for 45m") comes first when picking when.
  const lengthMs = (kind === "focus" ? 60 : 30) * 60_000;
  const typed = step === "pick" && kind !== "response" ? parseWhen(filter, nowMs, lengthMs) : null;
  const typedOption: Option[] =
    typed === null
      ? []
      : [
          {
            id: "typed",
            label: formatWhen(typed.startMs, nowMs),
            hint: `${Math.round((typed.endMs - typed.startMs) / 60_000)} min`,
            value: typed,
          },
        ];
  const options = [
    ...typedOption,
    ...(step === "invite" ? inviteOptions : pickOptions).filter(
      (option) => typed !== null || matches(option.label),
    ),
  ];
  const selectedIndex = Math.min(selected, Math.max(0, options.length - 1));
  const title = text.trim();
  const isInvited = (person: Person): boolean =>
    invitees.some((invitee) => invitee.id === person.id);

  const focusInput = (): void => inputRef.current?.focus();

  const goTo = (next: Step): void => {
    setStep(next);
    setFilter("");
    setSelected(0);
    focusInput();
  };

  const changeKind = (next: NewThreadKind): void => {
    setKind(next);
    // Stay put if the new kind has this step; otherwise drop back to writing.
    goTo(stepsFor(next).includes(step) ? step : "write");
  };

  // A meeting needs someone besides you before it can be scheduled.
  const needsInvitee = step === "invite" && invitees.length === 0;

  const forward = (): void => {
    if (text.trim().length === 0 || needsInvitee) {
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
      title,
      description: description.trim(),
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
    } else if (step === "invite") {
      const option = options[selectedIndex];
      // Space toggles the highlighted person. Enter moves on to picking a time, or invites the highlighted
      // person while nobody is invited yet.
      if (event.key === " " && option?.person !== undefined) {
        event.preventDefault();
        toggleInvitee(option.person);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (needsInvitee) {
          if (option?.person !== undefined) toggleInvitee(option.person);
        } else forward();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      create(options[selectedIndex]);
    }
  };

  const placeholder =
    step === "write"
      ? PLACEHOLDERS[kind]
      : step === "describe"
        ? "Add a description… (optional)"
        : step === "invite"
          ? "Invite people…"
          : kind === "response"
            ? "Assign to…"
            : "When… (fri 3pm, tomorrow 10:30 for 45m)";
  const summary =
    step === "describe"
      ? "Describe"
      : step === "invite"
        ? "Invite to"
        : kind === "response"
          ? "Assign"
          : "Schedule";
  const nextLabel = (): string => {
    if (text.trim().length === 0) {
      const what =
        kind === "response" ? "what you need" : kind === "meeting" ? "what it's about" : "the work";
      return `Write ${what} to continue`;
    }
    const nextStep = steps[steps.indexOf(step) + 1];
    return nextStep === "describe"
      ? "Continue to describe"
      : nextStep === "invite"
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
                        {invited && <HugeiconsIcon icon={Tick02Icon} size={12} />}
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
                  data-disabled={needsInvitee}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={forward}
                >
                  <span className="palette-row-label">
                    {needsInvitee ? "Invite someone to continue" : "Continue to schedule"}
                  </span>
                  {!needsInvitee && <span className="palette-row-shortcut">↵</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
