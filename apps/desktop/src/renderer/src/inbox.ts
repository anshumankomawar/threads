import {
  askerId,
  lastMessage,
  levelPositions,
  threadScore,
  waitingOn,
  type Person,
  type Thread,
} from "model";

export type InboxItem = {
  thread: Thread;
  // Who last wrote to you in a response, unless that was you.
  from: Person | null;
  reason: string;
  dueLabel: string | null;
  overdue: boolean;
  // How important it is, from 1 to 100; the same score the server schedules by.
  score: number;
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
  // Responses you're in that are waiting on the other person, labelled with who and when their slot is.
  outbox: InboxItem[];
  later: InboxItem[];
};

const DAY = 24 * 60 * 60 * 1000;

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

// The slot ends after the thread is due: the schedule couldn't fit it in time.
export function slotMissesDue(thread: Thread): boolean {
  return (
    thread.schedule !== null && thread.dueAtMs !== null && thread.schedule.endMs > thread.dueAtMs
  );
}

// A thread's score for whoever it's waiting on.
export function scoreOf(thread: Thread, people: Person[], nowMs: number): number {
  const asker = askerId(thread.requester.id, thread.assignee?.id ?? null, waitingOn(thread));
  return threadScore(thread, levelPositions(people)(asker), nowMs);
}

function reasonFor(thread: Thread, me: Person, sender: Person, nowMs: number): string {
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
    sender.id === me.managerId ? "From your manager" : `From ${sender.name}`,
    due !== null && due < nowMs
      ? "overdue"
      : days === 0
        ? "due today"
        : days === 1
          ? "due tomorrow"
          : null,
    thread.priority === "urgent" ? "urgent" : null,
    slotMissesDue(thread) ? "slot is after the due date" : null,
  ]
    .filter((reason): reason is string => reason !== null)
    .join(" · ");
}

// Rule-based plan for your day. Everything is a thread. A response sits with whoever it's waiting on, in a slot on
// their schedule (the server picks one each time it changes hands): on your timeline when that's the day shown, and
// in your inbox until its day comes. Responses you're in that wait on someone else are your outbox. Meetings you're in
// and your focus blocks sit on the timeline on their day; unplanned focus work is in the inbox, and the rest is Later.
export function buildDay(
  threads: Thread[],
  me: Person,
  people: Person[],
  nowMs: number,
  dayMs: number = startOfDay(nowMs),
): Day {
  const today = startOfDay(nowMs);
  const on = (start: number, ms: number): boolean => ms >= start && ms < start + DAY;
  const timeline: InboxItem[] = [];
  const unscheduled: InboxItem[] = [];
  const outbox: InboxItem[] = [];
  const later: InboxItem[] = [];

  for (const thread of threads) {
    if (thread.status === "closed") continue;
    const turn = waitingOn(thread);
    const involved =
      thread.requester.id === me.id ||
      thread.assignee?.id === me.id ||
      thread.attendees.some((person) => person.id === me.id);
    if (!involved && turn !== me.id) continue;
    const sender = lastMessage(thread)?.author ?? thread.requester;
    const due = thread.dueAtMs;
    const when = thread.schedule?.startMs ?? due;
    const overdue = thread.kind === "response" && due !== null && due < nowMs;
    const item = {
      thread,
      from: thread.kind === "response" && sender.id !== me.id ? sender : null,
      reason: reasonFor(thread, me, sender, nowMs),
      dueLabel: overdue ? "Overdue" : when === null ? null : shortDate(when, nowMs),
      overdue,
      score: scoreOf(thread, people, nowMs),
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
        // When they'll get to it: their slot, as a time today or a day.
        const eta =
          slot === undefined
            ? null
            : on(today, slot)
              ? new Date(slot).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
              : shortDate(slot, nowMs);
        outbox.push({ ...item, from: waitingFor ?? null, dueLabel: eta });
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
  // Threads needing an assignee come first; nobody else can act on them.
  const unassigned = ({ thread }: InboxItem): number =>
    Number(thread.kind === "response" && thread.assignee === null);
  const byScore = (a: InboxItem, b: InboxItem): number =>
    unassigned(b) - unassigned(a) || b.score - a.score;
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
