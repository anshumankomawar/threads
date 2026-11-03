import { assignedIds, involves, isDone, type Group, type Thread } from "model";

// The threads you and someone else are both in (`involves`), as their profile shows them: assigned to you, then to
// them, then the rest, most recently active first. Closed ones are kept apart, to show on request; archived ones never show.
// Everyone's client has every thread, so this is what a profile shows, not who may read what.
export type SharedThreads = {
  // Assigned to you (them too, perhaps).
  forYou: Thread[];
  // Assigned to them and not you.
  forThem: Thread[];
  // Open, and assigned to neither of you.
  others: Thread[];
  closed: Thread[];
};

export function sharedThreads(threads: Thread[], meId: string, personId: string): SharedThreads {
  const shared = threads
    .filter(
      (thread) =>
        thread.status !== "archived" && involves(thread, meId) && involves(thread, personId),
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
  const open = shared.filter((thread) => !isDone(thread.status));
  const forYou = open.filter((thread) => assignedIds(thread).includes(meId));
  const forThem = open.filter(
    (thread) => !forYou.includes(thread) && assignedIds(thread).includes(personId),
  );
  return {
    forYou,
    forThem,
    others: open.filter((thread) => !forYou.includes(thread) && !forThem.includes(thread)),
    closed: shared.filter((thread) => isDone(thread.status)),
  };
}

// The groups you're both in, by name, leaving out archived ones.
export function sharedGroups(groups: Group[], meId: string, personId: string): Group[] {
  return groups
    .filter(
      (group) =>
        !group.archived && group.memberIds.includes(meId) && group.memberIds.includes(personId),
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
