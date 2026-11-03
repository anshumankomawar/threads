import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Tag01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import {
  isDone,
  labelSlug,
  STATUS_LABELS,
  type Group,
  type GroupChanges,
  type Label,
  type Person,
  type Sprint,
  type SprintChanges,
  type Status,
  type Thread,
} from "model";
import { useState } from "react";
import { formatRelativeTime } from "../format";
import { NO_FILTER, threadsWithLabel, type ThreadFilter } from "../groups";
import { nextSprint, openSprintWith, sprintDates, sprintThreads } from "../sprints";
import { THREAD_ICON } from "../threadIcon";
import { useThreadMenu } from "../threadMenu";
import { Board } from "./Board";
import { Identicon } from "./Identicon";
import { SprintPanel } from "./SprintPanel";
import { MenuChip } from "./ThreadView";

// A group's members: anyone in it can add or remove people, and anyone can join or leave.
function Members({
  group,
  people,
  me,
  onUpdate,
  onOpenPerson,
}: {
  group: Group;
  people: Person[];
  me: Person;
  onUpdate: (changes: GroupChanges) => void;
  onOpenPerson: (id: string) => void;
}): React.JSX.Element {
  const isMember = group.memberIds.includes(me.id);
  const members = group.memberIds.flatMap((id) => people.find((person) => person.id === id) ?? []);
  const others = people.filter((person) => !group.memberIds.includes(person.id));
  const onlyMember = group.memberIds.length === 1;

  return (
    <ul className="group-members" aria-label="Members">
      {members.map((person) => (
        <li key={person.id} className="group-member">
          <Identicon seed={person.id} size={14} />
          <button type="button" className="person-link" onClick={() => onOpenPerson(person.id)}>
            {person.name}
          </button>
          {isMember && !onlyMember && (
            <button
              type="button"
              className="group-member-remove"
              aria-label={`Remove ${person.name}`}
              onClick={() =>
                onUpdate({ memberIds: group.memberIds.filter((id) => id !== person.id) })
              }
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} aria-hidden />
            </button>
          )}
        </li>
      ))}
      {isMember && others.length > 0 && !group.archived && (
        <li>
          <MenuChip
            label="Add someone"
            tone="muted"
            options={others.map((person) => ({
              label: person.name,
              value: person.id,
              icon: <Identicon seed={person.id} size={14} />,
            }))}
            onSelect={(id) => onUpdate({ memberIds: [...group.memberIds, id] })}
          />
        </li>
      )}
    </ul>
  );
}

// A group's own name, editable by its members.
function GroupTitle({
  group,
  labels,
  canEdit,
  onRename,
}: {
  group: Group;
  labels: Label[];
  canEdit: boolean;
  onRename: (name: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const slug = labelSlug(name.trim());
  const taken = labels.some(
    (label) => label.id !== group.labelId && (label.id === slug || labelSlug(label.name) === slug),
  );
  const valid = slug !== "" && !taken;

  if (!editing)
    return (
      <h1 className="list-page-title">
        {canEdit ? (
          <button
            type="button"
            className="group-title-button"
            title="Rename this group"
            onClick={() => {
              setName(group.name);
              setEditing(true);
            }}
          >
            {group.name}
          </button>
        ) : (
          group.name
        )}
      </h1>
    );
  return (
    <div>
      <input
        className="group-title-input"
        aria-label="Group name"
        autoFocus
        maxLength={80}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
          if (event.key === "Enter" && valid) {
            onRename(name.trim());
            setEditing(false);
          }
        }}
      />
      {taken && <p className="group-title-taken">That name is taken in your organization.</p>}
    </div>
  );
}

// The sprint menu's way to start one.
const NEW_SPRINT = "new-sprint";

// List or board, remembered on this device.
const VIEW_KEY = "list-view";
function savedView(): "list" | "board" {
  try {
    return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

// The organization's threads, in the main area: all of them, or a label's. A group's page is its label's threads, with
// its members too, since a thread is in a group by having the group's label. Open threads by default, and you can
// narrow by person (who owns it or is assigned it), by a group or label, and show closed ones. Any of it shows as a
// list or a board, and a group's page narrows to one of its sprints too.
export function LabelView({
  label,
  group,
  threads,
  people,
  labels,
  me,
  nowMs,
  unreadIds,
  onUpdateGroup,
  sprints,
  onCreateSprint,
  onUpdateSprint,
  onSetStatus,
  onNewThread,
  onOpenThread,
  onOpenPerson,
}: {
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
  onCreateSprint: (
    name: string,
    dates: { startMs: number; endMs: number },
    threadIds: string[],
  ) => string;
  onUpdateSprint: (sprintId: string, changes: SprintChanges) => void;
  onSetStatus: (thread: Thread, status: Status) => void;
  // From a sprint, the new thread goes in it.
  onNewThread: (sprintId: string | null) => void;
  onOpenThread: (id: string) => void;
  onOpenPerson: (id: string) => void;
}): React.JSX.Element {
  const openMenu = useThreadMenu();
  const [filter, setFilter] = useState<ThreadFilter>(NO_FILTER);
  const [view, setView] = useState<"list" | "board">(savedView);
  const [sprintId, setSprintId] = useState<string | null>(null);
  const sprint = sprints.find((candidate) => candidate.id === sprintId);
  const labelId = label?.id ?? null;
  // A sprint narrows the group's threads to its own; the other filters still apply.
  const pool =
    sprint === undefined || group === undefined
      ? threads
      : sprintThreads(sprint, threads, group.labelId);
  const everything = threadsWithLabel(pool, labelId, { ...filter, includeDone: true });
  // The board has a column for closed threads, so it always has them.
  const shown = view === "board" ? everything : threadsWithLabel(pool, labelId, filter);
  const closedCount = everything.filter((thread) => isDone(thread.status)).length;
  const inThese = threadsWithLabel(pool, labelId, { ...NO_FILTER, includeDone: true });
  const isMember = group?.memberIds.includes(me.id) ?? false;
  const chooseView = (next: "list" | "board"): void => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Remembering it is a convenience.
    }
  };
  const newSprint = (threadIds: string[]): void => {
    const next = nextSprint(sprints, nowMs);
    setSprintId(onCreateSprint(next.name, next, threadIds));
  };
  const personOptions = people.filter((person) =>
    inThese.some(
      (thread) =>
        thread.owner.id === person.id || thread.assignees.some((other) => other.id === person.id),
    ),
  );
  const labelOptions = labels.filter(
    (other) => other.id !== labelId && inThese.some((thread) => thread.labelIds.includes(other.id)),
  );
  const nameOf = (personId: string): string =>
    people.find((person) => person.id === personId)?.name ?? personId;
  const count = `${shown.length} ${shown.length === 1 ? "thread" : "threads"}`;

  return (
    <div className="list-page group-page">
      {group === undefined ? (
        <h1 className="list-page-title">{label?.name ?? "All threads"}</h1>
      ) : (
        <GroupTitle
          key={group.name}
          group={group}
          labels={labels}
          canEdit={isMember}
          onRename={(name) => onUpdateGroup({ name })}
        />
      )}
      <p className="list-page-summary">
        <HugeiconsIcon
          icon={group !== undefined ? UserGroupIcon : label !== null ? Tag01Icon : THREAD_ICON}
          size={11}
          aria-hidden
        />{" "}
        {group === undefined
          ? `${label === null ? "Everyone's" : "Label"} · ${count}`
          : `${group.memberIds.length} ${group.memberIds.length === 1 ? "member" : "members"} · ${count}${group.archived ? " · Archived" : ""}`}
      </p>

      {group !== undefined && (
        <>
          <Members
            group={group}
            people={people}
            me={me}
            onUpdate={onUpdateGroup}
            onOpenPerson={onOpenPerson}
          />
          <div className="group-actions">
            {!isMember && !group.archived && (
              <button
                type="button"
                className="group-action"
                onClick={() => onUpdateGroup({ memberIds: [...group.memberIds, me.id] })}
              >
                Join
              </button>
            )}
            {isMember && group.memberIds.length > 1 && (
              <button
                type="button"
                className="group-action"
                onClick={() =>
                  onUpdateGroup({ memberIds: group.memberIds.filter((id) => id !== me.id) })
                }
              >
                Leave
              </button>
            )}
            {isMember && (
              <button
                type="button"
                className="group-action"
                onClick={() => onUpdateGroup({ archived: !group.archived })}
              >
                {group.archived ? "Unarchive" : "Archive"}
              </button>
            )}
          </div>
        </>
      )}

      {sprint !== undefined && group !== undefined && (
        <SprintPanel
          key={sprint.id}
          sprint={sprint}
          threads={sprintThreads(sprint, threads, group.labelId)}
          groupThreads={threads}
          groupSprints={sprints}
          labelId={group.labelId}
          canEdit={isMember}
          onUpdate={(changes) => onUpdateSprint(sprint.id, changes)}
          // Only what isn't already in another open sprint can go in the next.
          onStartNext={(threadIds) =>
            newSprint(
              threadIds.filter((threadId) => openSprintWith(sprints, threadId) === undefined),
            )
          }
          onOpenPerson={onOpenPerson}
        />
      )}

      <div className="group-toolbar">
        {group?.archived !== true && (
          <button
            type="button"
            className="group-new"
            onClick={() => onNewThread(sprint !== undefined && !sprint.closed ? sprint.id : null)}
          >
            New thread
          </button>
        )}
        <span className="view-toggle" role="group" aria-label="View">
          {(["list", "board"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="view-toggle-option"
              aria-pressed={view === option}
              onClick={() => chooseView(option)}
            >
              {option === "list" ? "List" : "Board"}
            </button>
          ))}
        </span>
        <span className="group-filters">
          {group !== undefined && (sprints.length > 0 || (isMember && !group.archived)) && (
            <MenuChip
              label={sprint === undefined ? "Any sprint" : sprint.name}
              tone={sprint === undefined ? "muted" : undefined}
              options={[
                { label: "Any sprint", value: null as string | null },
                ...sprints.map((option) => ({
                  label: `${option.name} · ${option.closed ? "Closed" : sprintDates(option)}`,
                  value: option.id as string | null,
                })),
                ...(isMember && !group.archived
                  ? [{ label: "New sprint", value: NEW_SPRINT }]
                  : []),
              ]}
              onSelect={(value) => (value === NEW_SPRINT ? newSprint([]) : setSprintId(value))}
            />
          )}
          <MenuChip
            label={filter.personId === null ? "Anyone" : nameOf(filter.personId)}
            tone={filter.personId === null ? "muted" : undefined}
            options={[
              { label: "Anyone", value: null as string | null },
              ...personOptions.map((person) => ({ label: person.name, value: person.id })),
            ]}
            onSelect={(personId) => setFilter((current) => ({ ...current, personId }))}
          />
          {labelOptions.length > 0 && (
            <MenuChip
              label={
                labels.find((other) => other.id === filter.labelId)?.name ?? "Any group or label"
              }
              tone={filter.labelId === null ? "muted" : undefined}
              options={[
                { label: "Any group or label", value: null as string | null },
                ...labelOptions.map((other) => ({ label: other.name, value: other.id })),
              ]}
              onSelect={(labelId) => setFilter((current) => ({ ...current, labelId }))}
            />
          )}
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
          {sprint === undefined ? "No threads here yet." : "Nothing in this sprint yet."}
        </p>
      ) : (
        <ul className="list-page-items">
          {shown.map((thread) => {
            const meta = [
              thread.assignees.length === 0
                ? "Unassigned"
                : thread.assignees.map((person) => person.name.split(" ")[0]).join(", "),
              thread.status === "open" ? null : STATUS_LABELS[thread.status],
            ]
              .filter((part) => part !== null)
              .join(" · ");
            return (
              <li key={thread.id}>
                <button
                  type="button"
                  className="list-page-item"
                  onClick={() => onOpenThread(thread.id)}
                  onContextMenu={(event) => openMenu(event, thread)}
                >
                  <span className="list-page-icon" aria-hidden>
                    <HugeiconsIcon icon={THREAD_ICON} size={13} />
                  </span>
                  <span className="list-page-body">
                    <span className="list-page-name">
                      {thread.title}
                      {unreadIds.has(thread.id) && (
                        <span className="unread-dot" aria-label="Unread" />
                      )}
                    </span>
                    <span className="list-page-reason">{`By ${thread.owner.name}`}</span>
                  </span>
                  {meta !== "" && <span className="list-page-meta">{meta}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {group !== undefined && group.activity.length > 0 && (
        <>
          <h2 className="group-heading">Activity</h2>
          <ul className="group-activity">
            {group.activity.toReversed().map((line) => (
              <li key={`${line.atMs}:${line.text}`}>
                {nameOf(line.actorId)} {line.text} · {formatRelativeTime(line.atMs, nowMs)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
