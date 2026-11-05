import { assignedIds, involves, isDone, type Group, type Thread } from "model";

// The threads you and someone else are both in, as their profile shows them, newest first: assigned to you, then
// to them, then the rest; closed ones apart. Every client has every thread: this is a view, not a lock.
export function sharedThreads(threads: Thread[], meId: string, personId: string) {
  const shared = threads
    .filter((t) => t.status !== "archived" && involves(t, meId) && involves(t, personId))
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
  const open = shared.filter((thread) => !isDone(thread.status));
  const forYou = open.filter((thread) => assignedIds(thread).includes(meId));
  const forThem = open.filter((t) => !forYou.includes(t) && assignedIds(t).includes(personId));
  return {
    forYou,
    forThem,
    others: open.filter((thread) => !forYou.includes(thread) && !forThem.includes(thread)),
    closed: shared.filter((thread) => isDone(thread.status)),
  };
}

export function sharedGroups(groups: Group[], meId: string, personId: string): Group[] {
  return groups
    .filter((g) => !g.archived && g.memberIds.includes(meId) && g.memberIds.includes(personId))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
