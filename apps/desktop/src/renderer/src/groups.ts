import { isDone, type Group, type Label, type Person, type Thread } from "model";

// A thread is in a group by having the group's label, so groups are read straight from the threads.
export type ThreadFilter = {
  includeDone: boolean;
  personId: string | null;
  labelId: string | null;
};

export const NO_FILTER: ThreadFilter = { includeDone: false, personId: null, labelId: null };

const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name);

// All threads, or a label's, narrowed by the filter, most recently active first; never archived ones.
export function threadsWithLabel(
  threads: Thread[],
  labelId: string | null,
  { includeDone, personId, labelId: also }: ThreadFilter = NO_FILTER,
): Thread[] {
  return threads
    .filter(
      (thread) =>
        (labelId === null || thread.labelIds.includes(labelId)) &&
        thread.status !== "archived" &&
        (includeDone || !isDone(thread.status)) &&
        (personId === null ||
          thread.owner.id === personId ||
          thread.assignees.some((person) => person.id === personId)) &&
        (also === null || thread.labelIds.includes(also)),
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function groupsFor(
  groups: Group[],
  me: Person,
): Record<"mine" | "others" | "archived", Group[]> {
  const live = groups.filter((group) => !group.archived).toSorted(byName);
  return {
    mine: live.filter((group) => group.memberIds.includes(me.id)),
    others: live.filter((group) => !group.memberIds.includes(me.id)),
    archived: groups.filter((group) => group.archived).toSorted(byName),
  };
}

// The labels people file things under: not groups' own.
export function filterLabels(labels: Label[]): Label[] {
  return labels.filter((label) => label.groupId === null).toSorted(byName);
}

// The labels offered when choosing some: all but archived groups'.
export function selectableLabels(labels: Label[], groups: Group[]): Label[] {
  const archived = new Set(groups.filter((group) => group.archived).map((group) => group.id));
  return labels.filter((label) => !archived.has(label.groupId ?? "")).toSorted(byName);
}

const WINDOW_MS = 7 * 24 * 60 * 60_000;

// For the notifications: the latest time someone else added you to each group, in the past week.
export function groupNoticesFor(
  groups: Group[],
  people: Person[],
  me: Person,
  seenAt: (group: Group) => number,
  nowMs: number,
): { group: Group; actor: Person; text: string; atMs: number; unread: boolean }[] {
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
    const unread = line.atMs > seenAt(group);
    return [{ group, actor, text: "added you to this group", atMs: line.atMs, unread }];
  });
}
