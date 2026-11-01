import {
  lastMessage,
  waitingOn,
  type Person,
  type Priority,
  type Relationship,
  type Thread,
} from "model";

export type InboxItem = {
  thread: Thread;
  // Who last wrote to you in a response, unless that was you.
  from: Person | null;
  reason: string;
  dueLabel: string | null;
  overdue: boolean;
};

export type Day = {
  // The day the timeline shows (its local midnight); today unless you've stepped to another.
  dayMs: number;
  // The hours the timeline lays out: the whole day; the view scrolls to the current hour.
  startHour: number;
  endHour: number;
  // Threads scheduled on that day, in start order.
  timeline: InboxItem[];
  // Waiting on you and not on today's timeline: responses (on whatever day their slot is) and unplanned focus.
  unscheduled: InboxItem[];
  // Responses you're in that are waiting on the other person, labelled with who.
  outbox: InboxItem[];
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

function reasonFor(
  thread: Thread,
  me: Person,
  sender: Person,
  relationship: Relationship,
  nowMs: number,
): string {
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
        ? `From ${sender.name} (lead)`
        : `From ${sender.name}`,
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

// Higher scores come first: the priority set on the thread, who it's from (by org relationship), and how soon it's due.
function score(thread: Thread, relationship: Relationship, nowMs: number): number {
  if (thread.kind === "response" && thread.assignee === null) return Infinity;
  const days = thread.dueAtMs === null ? null : daysUntil(thread.dueAtMs, nowMs);
  return (
    PRIORITY_WEIGHT[thread.priority] * 10 +
    RELATIONSHIP_WEIGHT[relationship] * 5 +
    (days === null ? 0 : Math.max(0, 7 - days))
  );
}

// Rule-based plan for your day. Everything is a thread. A response sits with whoever it's waiting on, in a slot on
// their schedule (the server picks one each time it changes hands): on your timeline when that's the day shown, and
// in your inbox until its day comes. Responses you're in that wait on someone else are your outbox. Meetings you're in
// and your focus blocks sit on the timeline on their day; unplanned focus work is in the inbox, and the rest is Later.
export function buildDay(
  threads: Thread[],
  me: Person,
  relationshipTo: (person: Person) => Relationship,
  nowMs: number,
  dayMs: number = startOfDay(nowMs),
): Day {
  const today = startOfDay(nowMs);
  const on = (start: number, ms: number): boolean => ms >= start && ms < start + DAY;
  const timeline: InboxItem[] = [];
  const unscheduled: (InboxItem & { score: number })[] = [];
  const outbox: (InboxItem & { score: number })[] = [];
  const later: (InboxItem & { score: number })[] = [];

  for (const thread of threads) {
    if (thread.status === "closed") continue;
    const turn = waitingOn(thread);
    const involved =
      thread.requester.id === me.id ||
      thread.assignee?.id === me.id ||
      thread.attendees.some((person) => person.id === me.id);
    if (!involved && turn !== me.id) continue;
    const sender = lastMessage(thread)?.author ?? thread.requester;
    const relationship = relationshipTo(sender);
    const due = thread.dueAtMs;
    const when = thread.schedule?.startMs ?? due;
    const overdue = thread.kind === "response" && due !== null && due < nowMs;
    const item = {
      thread,
      from: thread.kind === "response" && sender.id !== me.id ? sender : null,
      reason: reasonFor(thread, me, sender, relationship, nowMs),
      dueLabel: overdue ? "Overdue" : when === null ? null : shortDate(when, nowMs),
      overdue,
      score: score(thread, relationship, nowMs),
    };
    const slot = thread.schedule?.startMs;

    if (thread.kind === "response") {
      if (turn === me.id) {
        if (slot !== undefined && on(dayMs, slot)) timeline.push(item);
        if (slot === undefined || !on(today, slot)) unscheduled.push(item);
      } else if (turn !== null) {
        const waitingFor = [thread.requester, thread.assignee].find(
          (person) => person?.id === turn,
        );
        outbox.push({ ...item, from: waitingFor ?? null });
      }
    } else if (slot !== undefined && on(dayMs, slot)) {
      timeline.push(item);
    } else if (thread.kind === "focus" && slot === undefined) {
      unscheduled.push(item);
    } else {
      later.push(item);
    }
  }

  timeline.sort((a, b) => (a.thread.schedule?.startMs ?? 0) - (b.thread.schedule?.startMs ?? 0));
  const byScore = (a: { score: number }, b: { score: number }): number => b.score - a.score;
  return {
    dayMs,
    startHour: 0,
    endHour: 23,
    timeline,
    unscheduled: unscheduled.sort(byScore),
    outbox: outbox.sort((a, b) => b.thread.updatedAtMs - a.thread.updatedAtMs),
    later: later.sort(byScore),
  };
}
