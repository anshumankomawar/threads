import { isDone, type Person, type Sprint, type Status, type Thread } from "model";
import { DAY, startOfDay } from "./format";

// Sprints and the board, read from the sprints and threads: a sprint lists its threads, and the board lays any list
// of threads out by status. Neither changes a thread; dragging a card is the same status change as in the thread.

// A group's sprints: open ones first, then the newest first.
export function sprintsOf(sprints: Sprint[], groupId: string): Sprint[] {
  return sprints
    .filter((sprint) => sprint.groupId === groupId)
    .toSorted((a, b) => Number(a.closed) - Number(b.closed) || b.startMs - a.startMs);
}

// The threads in a sprint that are still in its group (those with its label), most recently active first. Archived
// threads stay out, as everywhere.
export function sprintThreads(sprint: Sprint, threads: Thread[], labelId: string): Thread[] {
  return threads
    .filter(
      (thread) =>
        sprint.threadIds.includes(thread.id) &&
        thread.labelIds.includes(labelId) &&
        thread.status !== "archived",
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export type SprintSummary = { total: number; closed: number; blocked: number };

export function summarize(threads: Thread[]): SprintSummary {
  return {
    total: threads.length,
    closed: threads.filter((thread) => isDone(thread.status)).length,
    blocked: threads.filter((thread) => thread.status === "blocked").length,
  };
}

// "12 threads · 7 closed · 3 blocked".
export function summaryLabel({ total, closed, blocked }: SprintSummary): string {
  return [
    `${total} ${total === 1 ? "thread" : "threads"}`,
    closed > 0 ? `${closed} closed` : null,
    blocked > 0 ? `${blocked} blocked` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

export type Load = { person: Person; threads: number; hours: number; unestimated: number };

// What's left for each assignee: their open threads and the hours estimated for them. A thread shared by several
// people counts in full for each, since each of them has it to do. Most hours first.
export function loadByPerson(threads: Thread[]): Load[] {
  const loads = new Map<string, Load>();
  for (const thread of threads) {
    if (isDone(thread.status)) continue;
    for (const person of thread.assignees) {
      const load = loads.get(person.id) ?? { person, threads: 0, hours: 0, unestimated: 0 };
      load.threads += 1;
      if (thread.effortHours === null) load.unestimated += 1;
      else load.hours += thread.effortHours;
      loads.set(person.id, load);
    }
  }
  return [...loads.values()].toSorted(
    (a, b) =>
      b.hours - a.hours || b.threads - a.threads || a.person.name.localeCompare(b.person.name),
  );
}

// The dates a sprint covers, as days: midnight on its first day, and midnight after its last.
export function daysLater(startMs: number, days: number): number {
  const date = new Date(startMs);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

const SPRINT_DAYS = 14;

// The next sprint in a group: numbered after the others, two weeks long, starting where the latest one ends if that's
// still ahead, else today.
export function nextSprint(
  groupSprints: Sprint[],
  nowMs: number,
): { name: string; startMs: number; endMs: number } {
  const today = startOfDay(nowMs);
  const latestEnd = Math.max(0, ...groupSprints.map((sprint) => sprint.endMs));
  const startMs = latestEnd > today ? latestEnd : today;
  return {
    name: `Sprint ${groupSprints.length + 1}`,
    startMs,
    endMs: daysLater(startMs, SPRINT_DAYS),
  };
}

// "Nov 2 – Nov 15": the last day is the one before `endMs`.
export function sprintDates(sprint: Pick<Sprint, "startMs" | "endMs">): string {
  const day = (ms: number): string =>
    new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day(sprint.startMs)} – ${day(sprint.endMs - DAY / 2)}`;
}

// The group's threads that could join a sprint: open, and not in it or another open sprint of the group already.
export function addableThreads(
  sprint: Sprint,
  threads: Thread[],
  labelId: string,
  groupSprints: Sprint[],
): Thread[] {
  const taken = new Set(
    groupSprints
      .filter((other) => other.id === sprint.id || !other.closed)
      .flatMap((other) => other.threadIds),
  );
  return threads
    .filter(
      (thread) =>
        thread.labelIds.includes(labelId) && !isDone(thread.status) && !taken.has(thread.id),
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
}

// The open sprint of a group a thread is in, if any.
export function openSprintWith(groupSprints: Sprint[], threadId: string): Sprint | undefined {
  return groupSprints.find((sprint) => !sprint.closed && sprint.threadIds.includes(threadId));
}

// The board's columns, by status. Archived threads are put away, so they're not on it.
export const BOARD_COLUMNS: { status: Exclude<Status, "archived">; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "blocked", label: "Blocked" },
  { status: "closed", label: "Closed" },
];

export function boardColumns(threads: Thread[]): Record<"open" | "blocked" | "closed", Thread[]> {
  return {
    open: threads.filter((thread) => thread.status === "open"),
    blocked: threads.filter((thread) => thread.status === "blocked"),
    closed: threads.filter((thread) => thread.status === "closed"),
  };
}
