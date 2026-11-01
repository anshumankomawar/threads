import {
  askerId,
  lastMessage,
  otherSide,
  levelPositions,
  threadScore,
  waitingOn,
  type Person,
  type Schedule,
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

// One block of time on the timeline. A thread has one of these for each of its blocks that day.
export type TimelineItem = InboxItem & { block: Schedule };

export type Day = {
  // The day the timeline shows (its local midnight); today unless you've stepped to another.
  dayMs: number;
  // The hours the timeline lays out: the whole day; the view scrolls to the current hour.
  startHour: number;
  endHour: number;
  // Blocks of time on that day, in start order.
  timeline: TimelineItem[];
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

// The schedule couldn't fit the thread in before it's due: its last block ends too late, or part of the assignee's
// estimate has no room in the days ahead.
export function slotMissesDue(thread: Thread): boolean {
  if (thread.dueAtMs === null || thread.status !== "open") return false;
  const last = thread.blocks.at(-1);
  if (last !== undefined && last.endMs > thread.dueAtMs) return true;
  if (thread.effortHours === null || waitingOn(thread) !== thread.assignee?.id) return false;
  const placed = thread.blocks.reduce(
    (minutes, block) => minutes + (block.endMs - block.startMs) / 60_000,
    thread.workedMinutes,
  );
  return thread.effortHours * 60 > placed;
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

// Rule-based plan for your day. Everything is a thread. A response sits with whoever it's waiting on, in blocks on
// their schedule (the server places them): on your timeline on the days shown, and in your inbox on days without any.
// Responses you're in that wait on someone else are your outbox. Meetings you're in
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
  const timeline: TimelineItem[] = [];
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
    // A blocked thread waits on its open blockers' assignees; it stays yours, off the schedule, labelled Blocked.
    const blockers = threads.filter(
      (candidate) => candidate.blocksId === thread.id && candidate.status !== "closed",
    );
    const blockedOn = blockers.flatMap((blocker) => blocker.assignee ?? []);
    const isBlocked = thread.status === "blocked";
    const item = {
      thread,
      // The other side of a response, since messages are a worklog and the last one may be yours.
      from: isBlocked ? null : otherSide(thread, me.id),
      reason: isBlocked
        ? blockedOn.length > 0
          ? `Blocked on ${blockedOn.map((person) => person.name).join(", ")}`
          : "Blocked"
        : reasonFor(thread, me, sender, nowMs),
      dueLabel: isBlocked
        ? "Blocked"
        : overdue
          ? "Overdue"
          : when === null
            ? null
            : shortDate(when, nowMs),
      overdue,
      score: scoreOf(thread, people, nowMs),
    };
    const slot = thread.schedule?.startMs;

    if (thread.kind === "response") {
      if (turn === me.id) {
        for (const block of thread.blocks)
          if (on(dayMs, block.startMs)) timeline.push({ ...item, block });
        if (!thread.blocks.some((block) => on(today, block.startMs))) unscheduled.push(item);
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
    } else if (thread.schedule !== null && on(dayMs, thread.schedule.startMs)) {
      timeline.push({ ...item, block: thread.schedule });
    } else if (thread.kind === "focus" && slot === undefined) {
      unscheduled.push(item);
    } else {
      later.push(item);
    }
  }

  timeline.sort((a, b) => a.block.startMs - b.block.startMs);
  // Threads needing an assignee come first; nobody else can act on them.
  const unassigned = ({ thread }: InboxItem): number =>
    Number(thread.kind === "response" && thread.assignee === null);
  // Blocked threads go last: there's nothing to do on them until they're unblocked.
  const blocked = ({ thread }: InboxItem): number => Number(thread.status === "blocked");
  const byScore = (a: InboxItem, b: InboxItem): number =>
    blocked(a) - blocked(b) || unassigned(b) - unassigned(a) || b.score - a.score;
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

// What's coming up on your schedule from now: each thread once, at its next block, soonest first, looking a week ahead.
export function upNext(
  threads: Thread[],
  me: Person,
  people: Person[],
  nowMs: number,
  limit: number,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  const day = new Date(startOfDay(nowMs));
  for (let offset = 0; offset < 7 && items.length < limit; offset++) {
    for (const item of buildDay(threads, me, people, nowMs, day.getTime()).timeline) {
      if (item.block.endMs <= nowMs || seen.has(item.thread.id)) continue;
      seen.add(item.thread.id);
      items.push(item);
    }
    day.setDate(day.getDate() + 1);
  }
  return items.slice(0, limit);
}
