import { Cancel01Icon, Tag01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import {
  isDone,
  labelSlug,
  type Group,
  type GroupChanges,
  type Label,
  type Person,
  type Sprint,
  type Status,
  type Thread,
} from "model";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { formatRelativeTime } from "../format";
import { NO_FILTER, threadsWithLabel, type ThreadFilter } from "../groups";
import { useListView } from "../listView";
import { sprintDates } from "../sprints";
import { THREAD_ICON } from "../threadIcon";
import { Board } from "./Board";
import { Icon } from "./Icon";
import { Identicon } from "./Identicon";
import { ThreadRows, ViewToggle } from "./ThreadItems";
import { MenuChip } from "./ThreadView";

// A group's members: anyone in it can add or remove people, and anyone can join or leave.
function Members(props: {
  group: Group;
  people: Person[];
  me: Person;
  onUpdate: (changes: GroupChanges) => void;
  onOpenPerson: (id: string) => void;
}): JSX.Element {
  const isMember = (): boolean => props.group.memberIds.includes(props.me.id);
  const members = createMemo(() =>
    props.group.memberIds.flatMap((id) => props.people.find((person) => person.id === id) ?? []),
  );
  const others = createMemo(() =>
    props.people.filter((person) => !props.group.memberIds.includes(person.id)),
  );
  const onlyMember = (): boolean => props.group.memberIds.length === 1;

  return (
    <ul class="group-members" aria-label="Members">
      <For each={members()}>
        {(person) => (
          <li class="group-member">
            <Identicon seed={person.id} size={14} />
            <button type="button" class="person-link" onClick={() => props.onOpenPerson(person.id)}>
              {person.name}
            </button>
            <Show when={isMember() && !onlyMember()}>
              <button
                type="button"
                class="group-member-remove"
                aria-label={`Remove ${person.name}`}
                onClick={() =>
                  props.onUpdate({
                    memberIds: props.group.memberIds.filter((id) => id !== person.id),
                  })
                }
              >
                <Icon icon={Cancel01Icon} size={10} aria-hidden="true" />
              </button>
            </Show>
          </li>
        )}
      </For>
      <Show when={isMember() && others().length > 0 && !props.group.archived}>
        <li>
          <MenuChip
            label="Add someone"
            tone="muted"
            options={others().map((person) => ({
              label: person.name,
              value: person.id,
              icon: <Identicon seed={person.id} size={14} />,
            }))}
            onSelect={(id) => props.onUpdate({ memberIds: [...props.group.memberIds, id] })}
          />
        </li>
      </Show>
    </ul>
  );
}

// A group's own name, editable by its members.
function GroupTitle(props: {
  group: Group;
  labels: Label[];
  canEdit: boolean;
  onRename: (name: string) => void;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal(untrack(() => props.group.name));
  const slug = (): string => labelSlug(name().trim());
  const taken = (): boolean =>
    props.labels.some(
      (label) =>
        label.id !== props.group.labelId &&
        (label.id === slug() || labelSlug(label.name) === slug()),
    );
  const valid = (): boolean => slug() !== "" && !taken();
  // A new name (from here or anyone else) starts the title over, as a fresh one.
  createEffect(
    () => props.group.name,
    (current) => {
      setEditing(false);
      setName(current);
    },
    { defer: true },
  );

  return (
    <Show
      when={editing()}
      fallback={
        <h1 class="list-page-title">
          <Show when={props.canEdit} fallback={props.group.name}>
            <button
              type="button"
              class="group-title-button"
              title="Rename this group"
              onClick={() => {
                setName(props.group.name);
                setEditing(true);
              }}
            >
              {props.group.name}
            </button>
          </Show>
        </h1>
      }
    >
      <div>
        <input
          ref={(el) => queueMicrotask(() => el.focus())}
          class="group-title-input"
          aria-label="Group name"
          maxlength={80}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            if (event.key === "Enter" && valid()) {
              props.onRename(name().trim());
              setEditing(false);
            }
          }}
        />
        <Show when={taken()}>
          <p class="group-title-taken">That name is taken in your organization.</p>
        </Show>
      </div>
    </Show>
  );
}

// The Sprints menu's way to start one.
const NEW_SPRINT = "new-sprint";

// The organization's threads, in the main area: all of them, or a label's. A group's page is its label's threads, with
// its members too, since a thread is in a group by having the group's label. Open threads by default, and you can
// narrow by person (who owns it or is assigned it), by a group or label, and show closed ones. Any of it shows as a
// list or a board. A group's Sprints menu opens its sprints, each on its own page (`SprintView`).
export function LabelView(props: {
  // Null for every thread.
  label: Label | null;
  group: Group | undefined;
  threads: Thread[];
  people: Person[];
  labels: Label[];
  me: Person;
  nowMs: number;
  unreadIds: Set<string>;
  onUpdateGroup: (changes: GroupChanges) => void;
  // The group's sprints (`sprintsOf`); none on a label's page or every thread.
  sprints: Sprint[];
  onOpenSprint: (sprintId: string) => void;
  onNewSprint: () => void;
  onSetStatus: (thread: Thread, status: Status) => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
  onOpenPerson: (id: string) => void;
}): JSX.Element {
  const [filter, setFilter] = createSignal<ThreadFilter>(NO_FILTER);
  const [view, setView] = useListView();
  const labelId = (): string | null => props.label?.id ?? null;
  const everything = createMemo(() =>
    threadsWithLabel(props.threads, labelId(), { ...filter(), includeDone: true }),
  );
  // The board has a column for closed threads, so it always has them.
  const shown = createMemo(() =>
    view() === "board" ? everything() : threadsWithLabel(props.threads, labelId(), filter()),
  );
  const closedCount = (): number => everything().filter((thread) => isDone(thread.status)).length;
  const inThese = createMemo(() =>
    threadsWithLabel(props.threads, labelId(), { ...NO_FILTER, includeDone: true }),
  );
  const isMember = (): boolean => props.group?.memberIds.includes(props.me.id) ?? false;
  const personOptions = (): Person[] =>
    props.people.filter((person) =>
      inThese().some(
        (thread) =>
          thread.owner.id === person.id || thread.assignees.some((other) => other.id === person.id),
      ),
    );
  const labelOptions = createMemo(() =>
    props.labels.filter(
      (other) =>
        other.id !== labelId() && inThese().some((thread) => thread.labelIds.includes(other.id)),
    ),
  );
  const nameOf = (personId: string): string =>
    props.people.find((person) => person.id === personId)?.name ?? personId;
  const count = (): string => `${shown().length} ${shown().length === 1 ? "thread" : "threads"}`;

  return (
    <div class="list-page group-page">
      <Show
        when={props.group}
        fallback={<h1 class="list-page-title">{props.label?.name ?? "All threads"}</h1>}
      >
        {(group) => (
          <GroupTitle
            group={group()}
            labels={props.labels}
            canEdit={isMember()}
            onRename={(name) => props.onUpdateGroup({ name })}
          />
        )}
      </Show>
      <p class="list-page-summary">
        <Icon
          icon={
            props.group !== undefined
              ? UserGroupIcon
              : props.label !== null
                ? Tag01Icon
                : THREAD_ICON
          }
          size={11}
          aria-hidden="true"
        />{" "}
        {props.group === undefined
          ? `${props.label === null ? "Everyone's" : "Label"} · ${count()}`
          : `${props.group.memberIds.length} ${props.group.memberIds.length === 1 ? "member" : "members"} · ${count()}${props.group.archived ? " · Archived" : ""}`}
      </p>

      <Show when={props.group}>
        {(group) => (
          <>
            <Members
              group={group()}
              people={props.people}
              me={props.me}
              onUpdate={props.onUpdateGroup}
              onOpenPerson={props.onOpenPerson}
            />
            <div class="group-actions">
              <Show when={!isMember() && !group().archived}>
                <button
                  type="button"
                  class="group-action"
                  onClick={() =>
                    props.onUpdateGroup({ memberIds: [...group().memberIds, props.me.id] })
                  }
                >
                  Join
                </button>
              </Show>
              <Show when={isMember() && group().memberIds.length > 1}>
                <button
                  type="button"
                  class="group-action"
                  onClick={() =>
                    props.onUpdateGroup({
                      memberIds: group().memberIds.filter((id) => id !== props.me.id),
                    })
                  }
                >
                  Leave
                </button>
              </Show>
              <Show when={isMember()}>
                <button
                  type="button"
                  class="group-action"
                  onClick={() => props.onUpdateGroup({ archived: !group().archived })}
                >
                  {group().archived ? "Unarchive" : "Archive"}
                </button>
              </Show>
            </div>
          </>
        )}
      </Show>

      <div class="group-toolbar">
        <Show when={props.group?.archived !== true}>
          <button type="button" class="group-new" onClick={() => props.onNewThread()}>
            New thread
          </button>
        </Show>
        <ViewToggle view={view()} onChange={setView} />
        {/* The group's sprints, each opening on its own page, and starting the next. */}
        <Show
          when={
            props.group !== undefined &&
            (props.sprints.length > 0 || (isMember() && !props.group.archived))
          }
        >
          <MenuChip
            label={
              props.sprints.some((sprint) => !sprint.closed)
                ? `Sprints · ${props.sprints.filter((sprint) => !sprint.closed).length} open`
                : "Sprints"
            }
            options={[
              ...props.sprints.map((sprint) => ({
                label: `${sprint.name} · ${sprint.closed ? "Closed" : sprintDates(sprint)}`,
                value: sprint.id,
              })),
              ...(isMember() && props.group?.archived !== true
                ? [{ label: "New sprint", value: NEW_SPRINT }]
                : []),
            ]}
            onSelect={(value) =>
              value === NEW_SPRINT ? props.onNewSprint() : props.onOpenSprint(value)
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
          <Show when={labelOptions().length > 0}>
            <MenuChip
              label={
                props.labels.find((other) => other.id === filter().labelId)?.name ??
                "Any group or label"
              }
              tone={filter().labelId === null ? "muted" : undefined}
              options={[
                { label: "Any group or label", value: null as string | null },
                ...labelOptions().map((other) => ({ label: other.name, value: other.id })),
              ]}
              onSelect={(labelId) => setFilter((current) => ({ ...current, labelId }))}
            />
          </Show>
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
        <p class="group-empty">No threads here yet.</p>
      ) : (
        <ThreadRows
          threads={shown()}
          unreadIds={props.unreadIds}
          onOpenThread={props.onOpenThread}
        />
      )}

      <Show when={props.group !== undefined && props.group.activity.length > 0}>
        <h2 class="group-heading">Activity</h2>
        <ul class="group-activity">
          <For each={props.group?.activity.toReversed() ?? []}>
            {(line) => (
              <li>
                {nameOf(line.actorId)} {line.text} · {formatRelativeTime(line.atMs, props.nowMs)}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
