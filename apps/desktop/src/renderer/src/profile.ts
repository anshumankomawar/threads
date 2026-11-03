import { involves, isDone, waitingOn, type Group, type Thread } from "model";

// The threads you and someone else are both in (`involves`), as their profile shows them: whose turn it is, then the
// rest, most recently active first. Closed ones are kept apart, to show on request; archived ones never show.
// Everyone's client has every thread, so this is what a profile shows, not who may read what.
export type SharedThreads = {
  // Waiting on you: yours to finish.
  waitingOnYou: Thread[];
  // Waiting on them.
  waitingOnThem: Thread[];
  // Open, and waiting on somebody else.
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
  return {
    waitingOnYou: open.filter((thread) => waitingOn(thread) === meId),
    waitingOnThem: open.filter((thread) => waitingOn(thread) === personId),
    others: open.filter((thread) => waitingOn(thread) !== meId && waitingOn(thread) !== personId),
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
