import type { Person, Priority, Relationship, Thread } from "model";

export type InboxItem = {
  thread: Thread;
  reason: string;
  dueLabel: string | null;
  overdue: boolean;
};

export type Day = {
  startHour: number;
  endHour: number;
  // Threads scheduled today, in start order.
  timeline: InboxItem[];
  unscheduled: InboxItem[];
  later: InboxItem[];
};

const DAY = 24 * 60 * 60 * 1000;
const PRIORITY_WEIGHT: Record<Priority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};
const RELATIONSHIP_WEIGHT: Record<Relationship, number> = { manager: 3, lead: 2, teammate: 1 };

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function daysUntil(atMs: number, nowMs: number): number {
  return Math.round((startOfDay(atMs) - startOfDay(nowMs)) / DAY);
}

function shortDate(atMs: number, nowMs: number): string {
  const days = daysUntil(atMs, nowMs);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const format: Intl.DateTimeFormatOptions =
    days < 7 ? { weekday: "short" } : { month: "short", day: "numeric" };
  return new Date(atMs).toLocaleDateString(undefined, format);
}

function isMine(thread: Thread, me: Person): boolean {
  if (thread.kind === "meeting") return thread.attendees.some((person) => person.id === me.id);
  if (thread.kind === "focus") return thread.requester.id === me.id;
  return (
    thread.assignee?.id === me.id || (thread.assignee === null && thread.requester.id === me.id)
  );
}

function reasonFor(thread: Thread, me: Person, relationship: Relationship, nowMs: number): string {
  if (thread.kind === "focus") return "Your focus block";
  if (thread.kind === "meeting") {
    const others = thread.attendees
      .filter((person) => person.id !== me.id)
      .map((person) => person.name);
    return others.length > 0 ? `Meeting with ${others.join(", ")}` : "Meeting";
  }
  if (thread.assignee === null) return "Needs an assignee";
  const due = thread.dueAtMs;
  const days = due === null ? null : daysUntil(due, nowMs);
  return [
    relationship === "manager"
      ? "From your manager"
      : relationship === "lead"
        ? `From ${thread.requester.name} (lead)`
        : `From ${thread.requester.name}`,
    due !== null && due < nowMs
      ? "overdue"
      : days === 0
        ? "due today"
        : days === 1
          ? "due tomorrow"
          : null,
    thread.priority === "urgent" ? "urgent" : null,
  ]
    .filter((reason): reason is string => reason !== null)
    .join(" · ");
}

// Higher scores come first: the priority set on the thread, who asked (by org relationship), and how soon it's due.
function score(thread: Thread, relationship: Relationship, nowMs: number): number {
  if (thread.kind === "response" && thread.assignee === null) return Infinity;
  const days = thread.dueAtMs === null ? null : daysUntil(thread.dueAtMs, nowMs);
  return (
    PRIORITY_WEIGHT[thread.priority] * 10 +
    RELATIONSHIP_WEIGHT[relationship] * 5 +
    (days === null ? 0 : Math.max(0, 7 - days))
  );
}

// Rule-based plan for your day. Everything is a thread: responses assigned to you, meetings you're in, and your
// focus blocks. Anything scheduled today sits on the timeline; responses assigned to you (or still needing an
// assignee) and unplanned focus work wait in Unscheduled, which is your inbox; the rest is Later: meetings and focus
// blocks on other days, and responses you've scheduled for a later day, unless they need attention today.
export function buildDay(
  threads: Thread[],
  me: Person,
  relationshipTo: (person: Person) => Relationship,
  nowMs: number,
): Day {
  const today = startOfDay(nowMs);
  const isToday = (ms: number): boolean => ms >= today && ms < today + DAY;
  const timeline: InboxItem[] = [];
  const unscheduled: (InboxItem & { score: number })[] = [];
  const later: (InboxItem & { score: number })[] = [];

  for (const thread of threads) {
    if (thread.status === "done" || !isMine(thread, me)) continue;
    const relationship = relationshipTo(thread.requester);
    const due = thread.dueAtMs;
    const when = thread.schedule?.startMs ?? due;
    const overdue = thread.kind === "response" && due !== null && due < nowMs;
    const item = {
      thread,
      reason: reasonFor(thread, me, relationship, nowMs),
      dueLabel: overdue ? "Overdue" : when === null ? null : shortDate(when, nowMs),
      overdue,
      score: score(thread, relationship, nowMs),
    };

    if (thread.schedule !== null && isToday(thread.schedule.startMs)) {
      timeline.push(item);
    } else if (
      (thread.kind === "focus" && thread.schedule === null) ||
      (thread.kind === "response" &&
        (thread.schedule === null ||
          thread.schedule.startMs < today ||
          thread.assignee === null ||
          overdue ||
          (due !== null && isToday(due)) ||
          thread.priority === "urgent"))
    ) {
      unscheduled.push(item);
    } else {
      later.push(item);
    }
  }

  timeline.sort((a, b) => (a.thread.schedule?.startMs ?? 0) - (b.thread.schedule?.startMs ?? 0));
  const byScore = (a: { score: number }, b: { score: number }): number => b.score - a.score;
  const hours = timeline.map((item) => new Date(item.thread.schedule?.startMs ?? 0).getHours());
  return {
    startHour: Math.min(9, ...hours),
    endHour: Math.max(18, ...hours),
    timeline,
    unscheduled: unscheduled.sort(byScore),
    later: later.sort(byScore),
  };
}
