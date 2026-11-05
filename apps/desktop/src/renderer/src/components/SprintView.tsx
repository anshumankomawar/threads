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
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
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
import { Icon } from "./Icon";
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
export function SprintView(props: {
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
}): JSX.Element {
  const [name, setName] = createSignal(untrack(() => props.sprint.name));
  const [filter, setFilter] = createSignal<ThreadFilter>(NO_FILTER);
  const [view, setView] = useListView();
  const canEdit = (): boolean => props.group.memberIds.includes(props.me.id);
  const inSprint = createMemo(() =>
    sprintThreads(props.sprint, props.threads, props.group.labelId),
  );
  const everything = createMemo(() =>
    threadsWithLabel(inSprint(), null, { ...filter(), includeDone: true }),
  );
  // The board has a column for closed threads, so it always has them.
  const shown = createMemo(() =>
    view() === "board" ? everything() : threadsWithLabel(inSprint(), null, filter()),
  );
  const closedCount = (): number => everything().filter((thread) => isDone(thread.status)).length;
  const loads = createMemo(() => loadByPerson(inSprint()));
  const unfinished = (): Thread[] => inSprint().filter((thread) => !isDone(thread.status));
  // Only what isn't already in another open sprint of the group can go in the next.
  const carried = createMemo(() =>
    unfinished().filter((thread) => openSprintWith(props.groupSprints, thread.id) === undefined),
  );
  const addable = createMemo(() =>
    addableThreads(props.sprint, props.threads, props.group.labelId, props.groupSprints),
  );
  const personOptions = (): Person[] =>
    props.people.filter((person) =>
      inSprint().some(
        (thread) =>
          thread.owner.id === person.id || thread.assignees.some((other) => other.id === person.id),
      ),
    );
  const nameOf = (personId: string): string =>
    props.people.find((person) => person.id === personId)?.name ?? personId;

  const saveName = (): void => {
    const trimmed = name().trim();
    if (trimmed === "" || trimmed === props.sprint.name) setName(props.sprint.name);
    else props.onUpdate({ name: trimmed });
  };

  return (
    <div class="list-page group-page sprint-page">
      <Show when={canEdit()} fallback={<h1 class="list-page-title">{props.sprint.name}</h1>}>
        <input
          class="sprint-title-input"
          aria-label="Sprint name"
          maxlength={80}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onBlur={saveName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(props.sprint.name);
              event.currentTarget.blur();
            }
          }}
        />
      </Show>
      <p class="list-page-summary">
        <Icon icon={UserGroupIcon} size={11} aria-hidden="true" />{" "}
        <button type="button" class="person-link" onClick={() => props.onOpenGroup()}>
          {props.group.name}
        </button>
        {` · ${sprintDates(props.sprint)} · ${summaryLabel(summarize(inSprint()))}${props.sprint.closed ? " · Closed" : ""}`}
      </p>

      <dl class="profile-facts">
        <dt>Dates</dt>
        <dd class="sprint-dates">
          <input
            type="date"
            aria-label="First day"
            disabled={!canEdit()}
            value={toDateInput(props.sprint.startMs)}
            onChange={(event) => {
              const startMs = fromDateInput(event.currentTarget.value);
              if (startMs !== null && startMs < props.sprint.endMs) props.onUpdate({ startMs });
            }}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            aria-label="Last day"
            disabled={!canEdit()}
            value={toDateInput(daysLater(props.sprint.endMs, -1))}
            onChange={(event) => {
              const day = fromDateInput(event.currentTarget.value);
              if (day !== null && day >= props.sprint.startMs)
                props.onUpdate({ endMs: daysLater(day, 1) });
            }}
          />
        </dd>
        <dt>Load</dt>
        <dd>
          <Show when={loads().length > 0} fallback="Nothing left">
            <ul class="sprint-load" aria-label="Load">
              <For each={loads()}>
                {(load) => (
                  <li>
                    <button
                      type="button"
                      class="person-link"
                      onClick={() => props.onOpenPerson(load.person.id)}
                    >
                      {load.person.name}
                    </button>
                    <span class="sprint-load-detail">
                      {[
                        load.hours > 0 ? formatEffort(load.hours) : null,
                        `${load.threads} ${load.threads === 1 ? "thread" : "threads"}`,
                        load.unestimated > 0 ? `${load.unestimated} not estimated` : null,
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </dd>
      </dl>

      <Show when={canEdit()}>
        <div class="group-actions">
          <button
            type="button"
            class="group-action"
            onClick={() => props.onUpdate({ closed: !props.sprint.closed })}
          >
            {props.sprint.closed ? "Reopen sprint" : "Close sprint"}
          </button>
          <Show when={props.sprint.closed && carried().length > 0 && !props.group.archived}>
            <button
              type="button"
              class="group-action"
              onClick={() => props.onStartNext(carried().map((thread) => thread.id))}
            >
              Start the next sprint with {carried().length} unfinished
            </button>
          </Show>
        </div>
      </Show>

      <div class="group-toolbar">
        <Show when={canEdit() && !props.sprint.closed && !props.group.archived}>
          <button type="button" class="group-new" onClick={() => props.onNewThread()}>
            New thread
          </button>
        </Show>
        <ViewToggle view={view()} onChange={setView} />
        <Show when={canEdit() && !props.sprint.closed && addable().length > 0}>
          <MenuChip
            label="Add threads"
            tone="muted"
            options={addable().map((thread) => ({ label: thread.title, value: thread.id }))}
            onSelect={(threadId) =>
              props.onUpdate({ threadIds: [...props.sprint.threadIds, threadId] })
            }
          />
        </Show>
        <span class="group-filters">
          <MenuChip
            label={filter().personId === null ? "Anyone" : nameOf(filter().personId ?? "")}
            tone={filter().personId === null ? "muted" : undefined}
            options={[
              { label: "Anyone", value: null as string | null },
              ...personOptions().map((person) => ({ label: person.name, value: person.id })),
            ]}
            onSelect={(personId) => setFilter((current) => ({ ...current, personId }))}
          />
          <Show when={closedCount() > 0 && view() === "list"}>
            <button
              type="button"
              class="chip"
              data-tone={filter().includeDone ? undefined : "muted"}
              aria-pressed={filter().includeDone ? "true" : "false"}
              onClick={() =>
                setFilter((current) => ({ ...current, includeDone: !current.includeDone }))
              }
            >
              {filter().includeDone ? "Showing closed" : `${closedCount()} closed`}
            </button>
          </Show>
        </span>
      </div>

      {view() === "board" ? (
        <Board
          threads={shown()}
          nowMs={props.nowMs}
          unreadIds={props.unreadIds}
          onOpenThread={props.onOpenThread}
          onSetStatus={props.onSetStatus}
        />
      ) : shown().length === 0 ? (
        <p class="group-empty">
          {inSprint().length === 0 ? "Nothing in this sprint yet." : "Nothing open in this sprint."}
        </p>
      ) : (
        <ThreadRows
          threads={shown()}
          unreadIds={props.unreadIds}
          onOpenThread={props.onOpenThread}
        />
      )}
    </div>
  );
}
