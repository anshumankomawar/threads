import type { Priority, Thread } from "model";

const PRIORITY_WEIGHT: Record<Priority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

// A user's open threads, most pressing first: highest priority, then soonest due, then latest activity.
export function openThreadsFor(threads: Iterable<Thread>, userId: string): Thread[] {
  return [...threads]
    .filter((thread) => thread.assignee?.id === userId && thread.status !== "done")
    .sort(
      (a, b) =>
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
        (a.dueAtMs ?? Infinity) - (b.dueAtMs ?? Infinity) ||
        b.updatedAtMs - a.updatedAtMs,
    );
}
