import { slotMinutes, type Schedule } from "model";

// The organization's working hours. Every schedule is laid out in them.
export const WORKING_HOURS = { timeZone: "America/Los_Angeles", startHour: 9, endHour: 17 };

const SLOT_MS = 30 * 60_000;
// A slot starting this soon, or already under way, stays put: nobody's plan changes as they sit down to it.
const FREEZE_MS = 30 * 60_000;
const WORKING_DAYS_AHEAD = 5;
// How many points higher a thread has to score to take a place ahead of another, so small differences don't reshuffle
// the day.
const DISPLACE_MARGIN = 10;
const MAX_DAYS_SCANNED = 14;

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: WORKING_HOURS.timeZone,
  weekday: "short",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

function localTime(ms: number): { weekday: string; day: string; hour: number; minute: number } {
  const parts = Object.fromEntries(clock.formatToParts(ms).map(({ type, value }) => [type, value]));
  return {
    weekday: parts.weekday,
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const nextSlotBoundary = (ms: number): number => Math.ceil(ms / SLOT_MS) * SLOT_MS;

// Every half hour that can hold work from now through the next few working days.
export function workingSlots(nowMs: number): number[] {
  const slots: number[] = [];
  const workingDays = new Set<string>();
  const end = nowMs + MAX_DAYS_SCANNED * 24 * 60 * 60_000;
  for (let start = nextSlotBoundary(nowMs); start < end; start += SLOT_MS) {
    const { weekday, day, hour } = localTime(start);
    if (weekday === "Sat" || weekday === "Sun") continue;
    if (hour < WORKING_HOURS.startHour || hour >= WORKING_HOURS.endHour) continue;
    workingDays.add(day);
    if (workingDays.size > WORKING_DAYS_AHEAD) break;
    slots.push(start);
  }
  return slots;
}

// When to next look over every schedule: half an hour before the working day starts.
export function nextPlanningMs(nowMs: number): number {
  let start = nextSlotBoundary(nowMs + 1);
  for (;;) {
    const { hour, minute } = localTime(start);
    if (hour === WORKING_HOURS.startHour - 1 && minute === 30) return start;
    start += SLOT_MS;
  }
}

export type Plannable = {
  id: string;
  score: number;
  effortHours?: number | null;
  schedule: Schedule | null;
};

// Where one person's threads go, given the fixed time they can't use (meetings, focus blocks).
//
// Threads keep their order unless one outscores the thread ahead of it by the margin. Threads with no slot yet, or
// whose slot passed with the thread still open, join the end by score and climb from there. In that order, each takes
// the earliest working time still free. A thread that doesn't fit in the days ahead gets no slot.
export function planSchedule(
  threads: Plannable[],
  fixed: Schedule[],
  nowMs: number,
  slots: number[],
): Map<string, Schedule | null> {
  const plan = new Map<string, Schedule | null>();
  const taken = [...fixed];
  const planned: Plannable[] = [];
  const waiting: Plannable[] = [];

  for (const thread of threads) {
    const { schedule } = thread;
    if (schedule !== null && schedule.endMs > nowMs && schedule.startMs <= nowMs + FREEZE_MS) {
      plan.set(thread.id, schedule);
      taken.push(schedule);
    } else if (schedule !== null && schedule.startMs > nowMs) {
      planned.push(thread);
    } else {
      waiting.push(thread);
    }
  }

  planned.sort(
    (a, b) => (a.schedule?.startMs ?? 0) - (b.schedule?.startMs ?? 0) || a.id.localeCompare(b.id),
  );
  waiting.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const order = [...planned, ...waiting];
  for (let index = 1; index < order.length; index++) {
    for (let at = index; at > 0 && order[at].score > order[at - 1].score + DISPLACE_MARGIN; at--) {
      [order[at - 1], order[at]] = [order[at], order[at - 1]];
    }
  }

  const working = new Set(slots);
  for (const thread of order) {
    const lengthMs = slotMinutes(thread.effortHours) * 60_000;
    const startMs = slots.find((start) => {
      for (let offset = 0; offset < lengthMs; offset += SLOT_MS)
        if (!working.has(start + offset)) return false;
      return !taken.some((block) => block.startMs < start + lengthMs && start < block.endMs);
    });
    if (startMs === undefined) {
      plan.set(thread.id, null);
      continue;
    }
    const schedule = { startMs, endMs: startMs + lengthMs };
    plan.set(thread.id, schedule);
    taken.push(schedule);
  }
  return plan;
}
