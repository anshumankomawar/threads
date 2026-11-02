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
  type Thread,
} from "model";
import { useState } from "react";
import { formatRelativeTime } from "../format";
import { NO_FILTER, threadsWithLabel, type ThreadFilter } from "../groups";
import { KIND_ICONS } from "../kindIcons";
import { useThreadMenu } from "../threadMenu";
import { Identicon } from "./Identicon";
import { MenuChip } from "./ThreadView";

// A group's members: anyone in it can add or remove people, and anyone can join or leave.
function Members({
  group,
  people,
  me,
  onUpdate,
}: {
  group: Group;
  people: Person[];
  me: Person;
  onUpdate: (changes: GroupChanges) => void;
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
          {person.name}
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

// A label's threads, in the main area: for a group, with its members and history too, since a thread is in a group by
// having the group's label. Open threads by default, and you can narrow by person or by another label.
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
  onNewThread,
  onOpenThread,
}: {
  label: Label;
  group: Group | undefined;
  threads: Thread[];
  people: Person[];
  labels: Label[];
  me: Person;
  nowMs: number;
  unreadIds: Set<string>;
  onUpdateGroup: (changes: GroupChanges) => void;
  onNewThread: () => void;
  onOpenThread: (id: string) => void;
}): React.JSX.Element {
  const openMenu = useThreadMenu();
  const [filter, setFilter] = useState<ThreadFilter>(NO_FILTER);
  const everything = threadsWithLabel(threads, label.id, { ...filter, includeDone: true });
  const shown = threadsWithLabel(threads, label.id, filter);
  const closedCount = everything.filter((thread) => isDone(thread.status)).length;
  const inThese = threadsWithLabel(threads, label.id, { ...NO_FILTER, includeDone: true });
  const personOptions = people.filter((person) =>
    inThese.some(
      (thread) => thread.assignee?.id === person.id || thread.requester.id === person.id,
    ),
  );
  const labelOptions = labels.filter(
    (other) =>
      other.id !== label.id && inThese.some((thread) => thread.labelIds.includes(other.id)),
  );
  const isMember = group?.memberIds.includes(me.id) ?? false;
  const nameOf = (personId: string): string =>
    people.find((person) => person.id === personId)?.name ?? personId;
  const count = `${shown.length} ${shown.length === 1 ? "thread" : "threads"}`;

  return (
    <div className="list-page group-page">
      {group === undefined ? (
        <h1 className="list-page-title">{label.name}</h1>
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
          icon={group === undefined ? Tag01Icon : UserGroupIcon}
          size={11}
          aria-hidden
        />{" "}
        {group === undefined
          ? `Label · ${count}`
          : `${group.memberIds.length} ${group.memberIds.length === 1 ? "member" : "members"} · ${count}${group.archived ? " · Archived" : ""}`}
      </p>

      {group !== undefined && (
        <>
          <Members group={group} people={people} me={me} onUpdate={onUpdateGroup} />
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

      <div className="group-toolbar">
        {group?.archived !== true && (
          <button type="button" className="group-new" onClick={onNewThread}>
            New thread
          </button>
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
          {labelOptions.length > 0 && (
            <MenuChip
              label={labels.find((other) => other.id === filter.labelId)?.name ?? "Any label"}
              tone={filter.labelId === null ? "muted" : undefined}
              options={[
                { label: "Any label", value: null as string | null },
                ...labelOptions.map((other) => ({ label: other.name, value: other.id })),
              ]}
              onSelect={(labelId) => setFilter((current) => ({ ...current, labelId }))}
            />
          )}
          {closedCount > 0 && (
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

      {shown.length === 0 ? (
        <p className="group-empty">No threads here yet.</p>
      ) : (
        <ul className="list-page-items">
          {shown.map((thread) => {
            const meta = [
              thread.assignee?.name ?? (thread.kind === "response" ? "Unassigned" : null),
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
                    <HugeiconsIcon icon={KIND_ICONS[thread.kind]} size={13} />
                  </span>
                  <span className="list-page-body">
                    <span className="list-page-name">
                      {thread.title}
                      {unreadIds.has(thread.id) && (
                        <span className="unread-dot" aria-label="Unread" />
                      )}
                    </span>
                    <span className="list-page-reason">{`Asked by ${thread.requester.name}`}</span>
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
