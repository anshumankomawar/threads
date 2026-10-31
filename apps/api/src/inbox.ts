import { waitingOn, type Priority, type Thread } from "model";

const PRIORITY_WEIGHT: Record<Priority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

// Highest priority, then soonest due, then latest activity.
function mostPressingFirst(a: Thread, b: Thread): number {
  return (
    PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
    (a.dueAtMs ?? Infinity) - (b.dueAtMs ?? Infinity) ||
    b.updatedAtMs - a.updatedAtMs
  );
}

// The open threads a user is assigned to work on, most pressing first.
export function openThreadsFor(threads: Iterable<Thread>, userId: string): Thread[] {
  return [...threads]
    .filter((thread) => thread.assignee?.id === userId && thread.status !== "done")
    .sort(mostPressingFirst);
}

// The open threads waiting on a user, most pressing first.
export function inboxThreadsFor(threads: Iterable<Thread>, userId: string): Thread[] {
  return [...threads]
    .filter((thread) => waitingOn(thread) === userId && thread.status !== "done")
    .sort(mostPressingFirst);
}
