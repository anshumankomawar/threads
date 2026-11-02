import { isDone, type Group, type Label, type Person, type Thread } from "model";

// Groups and labels, read straight from the threads: a thread is in a group because it has the group's label, so
// there's nothing to keep in step.

export type ThreadFilter = {
  // Open threads only, or closed ones too.
  includeDone: boolean;
  // Only threads this person has or asked for.
  personId: string | null;
  // Only threads that also have this label.
  labelId: string | null;
};

export const NO_FILTER: ThreadFilter = { includeDone: false, personId: null, labelId: null };

// The threads with a label, most recently active first. Archived threads stay out; they're put away.
export function threadsWithLabel(
  threads: Thread[],
  labelId: string,
  filter: ThreadFilter = NO_FILTER,
): Thread[] {
  return threads
    .filter(
      (thread) =>
        thread.labelIds.includes(labelId) &&
        thread.status !== "archived" &&
        (filter.includeDone || !isDone(thread.status)) &&
        (filter.personId === null ||
          thread.assignee?.id === filter.personId ||
          thread.requester.id === filter.personId) &&
        (filter.labelId === null || thread.labelIds.includes(filter.labelId)),
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export type GroupLists = { mine: Group[]; others: Group[]; archived: Group[] };

// Your groups first, then everyone else's, by name, with archived ones to the side.
export function groupsFor(groups: Group[], me: Person): GroupLists {
  const byName = (a: Group, b: Group): number => a.name.localeCompare(b.name);
  const live = groups.filter((group) => !group.archived).toSorted(byName);
  return {
    mine: live.filter((group) => group.memberIds.includes(me.id)),
    others: live.filter((group) => !group.memberIds.includes(me.id)),
    archived: groups.filter((group) => group.archived).toSorted(byName),
  };
}

// The labels people file things under, leaving out groups' own, by name.
export function filterLabels(labels: Label[]): Label[] {
  return labels
    .filter((label) => label.groupId === null)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

// The labels offered when choosing some: everything but the labels of archived groups.
export function selectableLabels(labels: Label[], groups: Group[]): Label[] {
  const archived = new Set(groups.filter((group) => group.archived).map((group) => group.id));
  return labels
    .filter((label) => label.groupId === null || !archived.has(label.groupId))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export type GroupNotice = {
  group: Group;
  actor: Person;
  text: string;
  atMs: number;
  unread: boolean;
};

const WINDOW_MS = 7 * 24 * 60 * 60_000;

// Being added to a group, for the notifications: the latest time someone else added you to each, in the past week.
export function groupNoticesFor(
  groups: Group[],
  people: Person[],
  me: Person,
  seenAt: (group: Group) => number,
  nowMs: number,
): GroupNotice[] {
  return groups.flatMap((group) => {
    if (group.archived || !group.memberIds.includes(me.id)) return [];
    const line = group.activity.findLast(
      (entry) =>
        entry.targetIds.includes(me.id) &&
        entry.actorId !== me.id &&
        entry.atMs >= nowMs - WINDOW_MS,
    );
    const actor = people.find((person) => person.id === line?.actorId);
    if (line === undefined || actor === undefined) return [];
    return [
      {
        group,
        actor,
        text: "added you to this group",
        atMs: line.atMs,
        unread: line.atMs > seenAt(group),
      },
    ];
  });
}
