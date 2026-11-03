import { formatEffort, isDone, type Sprint, type SprintChanges, type Thread } from "model";
import { useState } from "react";
import { addableThreads, daysLater, loadByPerson, summarize, summaryLabel } from "../sprints";
import { MenuChip } from "./ThreadView";

// A date input's value for a local midnight, and back.
const toDateInput = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const fromDateInput = (value: string): number | null => {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day).getTime() : null;
};

// The sprint picked on a group's page, above its threads: its name and dates, how far along it is, what's left for
// each person, and (for the group's members) adding threads, closing it, and carrying what's unfinished into the next.
export function SprintPanel({
  sprint,
  threads,
  groupThreads,
  groupSprints,
  labelId,
  canEdit,
  onUpdate,
  onStartNext,
  onOpenPerson,
}: {
  sprint: Sprint;
  // The threads in it, closed ones too.
  threads: Thread[];
  // Every thread, to find the group's that could join.
  groupThreads: Thread[];
  groupSprints: Sprint[];
  labelId: string;
  canEdit: boolean;
  onUpdate: (changes: SprintChanges) => void;
  // A new sprint with these threads in it.
  onStartNext: (threadIds: string[]) => void;
  onOpenPerson: (id: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState(sprint.name);
  const summary = summarize(threads);
  const loads = loadByPerson(threads);
  const unfinished = threads.filter((thread) => !isDone(thread.status));
  const addable = addableThreads(sprint, groupThreads, labelId, groupSprints);
  const lastDay = daysLater(sprint.endMs, -1);

  const saveName = (): void => {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === sprint.name) setName(sprint.name);
    else onUpdate({ name: trimmed });
  };

  return (
    <section className="sprint" aria-label={sprint.name}>
      <div className="sprint-head">
        {canEdit ? (
          <input
            className="sprint-name"
            aria-label="Sprint name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setName(sprint.name);
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span className="sprint-name">{sprint.name}</span>
        )}
        <span className="sprint-dates">
          <input
            type="date"
            aria-label="First day"
            disabled={!canEdit}
            value={toDateInput(sprint.startMs)}
            onChange={(event) => {
              const startMs = fromDateInput(event.target.value);
              if (startMs !== null && startMs < sprint.endMs) onUpdate({ startMs });
            }}
          />
          <span aria-hidden>–</span>
          <input
            type="date"
            aria-label="Last day"
            disabled={!canEdit}
            value={toDateInput(lastDay)}
            onChange={(event) => {
              const day = fromDateInput(event.target.value);
              if (day !== null && day >= sprint.startMs) onUpdate({ endMs: daysLater(day, 1) });
            }}
          />
        </span>
        {sprint.closed && <span className="sprint-closed">Closed</span>}
      </div>
      <p className="sprint-summary">{summaryLabel(summary)}</p>

      {loads.length > 0 && (
        <ul className="sprint-load" aria-label="Load">
          {loads.map((load) => (
            <li key={load.person.id}>
              <button
                type="button"
                className="person-link"
                onClick={() => onOpenPerson(load.person.id)}
              >
                {load.person.name}
              </button>
              <span className="sprint-load-detail">
                {[
                  load.hours > 0 ? formatEffort(load.hours) : null,
                  `${load.threads} ${load.threads === 1 ? "thread" : "threads"}`,
                  load.unestimated > 0 ? `${load.unestimated} not estimated` : null,
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="sprint-actions">
          {!sprint.closed && addable.length > 0 && (
            <MenuChip
              label="Add threads"
              tone="muted"
              options={addable.map((thread) => ({ label: thread.title, value: thread.id }))}
              onSelect={(threadId) => onUpdate({ threadIds: [...sprint.threadIds, threadId] })}
            />
          )}
          <button
            type="button"
            className="group-action"
            onClick={() => onUpdate({ closed: !sprint.closed })}
          >
            {sprint.closed ? "Reopen sprint" : "Close sprint"}
          </button>
          {sprint.closed && unfinished.length > 0 && (
            <button
              type="button"
              className="group-action"
              onClick={() => onStartNext(unfinished.map((thread) => thread.id))}
            >
              Start the next sprint with {unfinished.length} unfinished
            </button>
          )}
        </div>
      )}
    </section>
  );
}
