import { HugeiconsIcon } from "@hugeicons/react";
import { UserGroupIcon } from "@hugeicons/core-free-icons";
import {
  formatEffort,
  isDone,
  type Group,
  type Person,
  type Sprint,
  type SprintChanges,
  type Status,
  type Thread,
} from "model";
import { useState } from "react";
import { NO_FILTER, threadsWithLabel, type ThreadFilter } from "../groups";
import { useListView } from "../listView";
import {
  addableThreads,
  daysLater,
  loadByPerson,
  openSprintWith,
  sprintDates,
  sprintThreads,
  summarize,
  summaryLabel,
} from "../sprints";
import { Board } from "./Board";
import { ThreadRows, ViewToggle } from "./ThreadItems";
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

// A sprint's own page, opened from its group's Sprints menu: its name and dates, how far along it is, what's left for
// each person, and its threads as a list or a board. The group's members add threads, close it, and carry what's
// unfinished into the next. Only the group's threads are in it (`sprintThreads`).
export function SprintView({
  sprint,
  group,
  threads,
  people,
  me,
  nowMs,
  unreadIds,
  groupSprints,
  onUpdate,
  onStartNext,
  onOpenGroup,
  onOpenPerson,
  onNewThread,
  onOpenThread,
  onSetStatus,
}: {
  sprint: Sprint;
  group: Group;
  threads: Thread[];
  people: Person[];
  me: Person;
  nowMs: number;
  unreadIds: Set<string>;
  groupSprints: Sprint[];
  onUpdate: (changes: SprintChanges) => void;
  // A new sprint in the group with these threads in it.
  onStartNext: (threadIds: string[]) => void;
  onOpenGroup: () => void;
  onOpenPerson: (id: string) => void;
  // A new thread in the group, and in this sprint.
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onSetStatus: (thread: Thread, status: Status) => void;
}): React.JSX.Element {
  const [name, setName] = useState(sprint.name);
  const [filter, setFilter] = useState<ThreadFilter>(NO_FILTER);
  const [view, setView] = useListView();
  const canEdit = group.memberIds.includes(me.id);
  const inSprint = sprintThreads(sprint, threads, group.labelId);
  const everything = threadsWithLabel(inSprint, null, { ...filter, includeDone: true });
  // The board has a column for closed threads, so it always has them.
  const shown = view === "board" ? everything : threadsWithLabel(inSprint, null, filter);
  const closedCount = everything.filter((thread) => isDone(thread.status)).length;
  const loads = loadByPerson(inSprint);
  const unfinished = inSprint.filter((thread) => !isDone(thread.status));
  // Only what isn't already in another open sprint of the group can go in the next.
  const carried = unfinished.filter(
    (thread) => openSprintWith(groupSprints, thread.id) === undefined,
  );
  const addable = addableThreads(sprint, threads, group.labelId, groupSprints);
  const personOptions = people.filter((person) =>
    inSprint.some(
      (thread) =>
        thread.owner.id === person.id || thread.assignees.some((other) => other.id === person.id),
    ),
  );
  const nameOf = (personId: string): string =>
    people.find((person) => person.id === personId)?.name ?? personId;

  const saveName = (): void => {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === sprint.name) setName(sprint.name);
    else onUpdate({ name: trimmed });
  };

  return (
    <div className="list-page group-page sprint-page">
      {canEdit ? (
        <input
          className="sprint-title-input"
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
        <h1 className="list-page-title">{sprint.name}</h1>
      )}
      <p className="list-page-summary">
        <HugeiconsIcon icon={UserGroupIcon} size={11} aria-hidden />{" "}
        <button type="button" className="person-link" onClick={onOpenGroup}>
          {group.name}
        </button>
        {` · ${sprintDates(sprint)} · ${summaryLabel(summarize(inSprint))}${sprint.closed ? " · Closed" : ""}`}
      </p>

      <dl className="profile-facts">
        <dt>Dates</dt>
        <dd className="sprint-dates">
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
            value={toDateInput(daysLater(sprint.endMs, -1))}
            onChange={(event) => {
              const day = fromDateInput(event.target.value);
              if (day !== null && day >= sprint.startMs) onUpdate({ endMs: daysLater(day, 1) });
            }}
          />
        </dd>
        <dt>Load</dt>
        <dd>
          {loads.length === 0 ? (
            "Nothing left"
          ) : (
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
        </dd>
      </dl>

      {canEdit && (
        <div className="group-actions">
          <button
            type="button"
            className="group-action"
            onClick={() => onUpdate({ closed: !sprint.closed })}
          >
            {sprint.closed ? "Reopen sprint" : "Close sprint"}
          </button>
          {sprint.closed && carried.length > 0 && !group.archived && (
            <button
              type="button"
              className="group-action"
              onClick={() => onStartNext(carried.map((thread) => thread.id))}
            >
              Start the next sprint with {carried.length} unfinished
            </button>
          )}
        </div>
      )}

      <div className="group-toolbar">
        {canEdit && !sprint.closed && !group.archived && (
          <button type="button" className="group-new" onClick={onNewThread}>
            New thread
          </button>
        )}
        <ViewToggle view={view} onChange={setView} />
        {canEdit && !sprint.closed && addable.length > 0 && (
          <MenuChip
            label="Add threads"
            tone="muted"
            options={addable.map((thread) => ({ label: thread.title, value: thread.id }))}
            onSelect={(threadId) => onUpdate({ threadIds: [...sprint.threadIds, threadId] })}
          />
        )}
        <span className="group-filters">
          <MenuChip
            label={filter.personId === null ? "Anyone" : nameOf(filter.personId)}
            tone={filter.personId === null ? "muted" : undefined}
            options={[
              { label: "Anyone", value: null as string | null },
              ...personOptions.map((person) => ({ label: person.name, value: person.id })),
            ]}
            onSelect={(personId) => setFilter((current) => ({ ...current, personId }))}
          />
          {closedCount > 0 && view === "list" && (
            <button
              type="button"
              className="chip"
              data-tone={filter.includeDone ? undefined : "muted"}
              aria-pressed={filter.includeDone}
              onClick={() =>
                setFilter((current) => ({ ...current, includeDone: !current.includeDone }))
              }
            >
              {filter.includeDone ? "Showing closed" : `${closedCount} closed`}
            </button>
          )}
        </span>
      </div>

      {view === "board" ? (
        <Board
          threads={shown}
          nowMs={nowMs}
          unreadIds={unreadIds}
          onOpenThread={onOpenThread}
          onSetStatus={onSetStatus}
        />
      ) : shown.length === 0 ? (
        <p className="group-empty">
          {inSprint.length === 0 ? "Nothing in this sprint yet." : "Nothing open in this sprint."}
        </p>
      ) : (
        <ThreadRows threads={shown} unreadIds={unreadIds} onOpenThread={onOpenThread} />
      )}
    </div>
  );
}
