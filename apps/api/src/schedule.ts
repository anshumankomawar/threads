import type { Thread } from "./model.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SLOT_MS = 30 * MINUTE;
const WORKDAY_START_MS = 9 * HOUR;
const WORKDAY_END_MS = 18 * HOUR;

export type ScheduleItem = {
  threadId: string;
  title: string;
  startMs: number;
  endMs: number;
  source: "user" | "auto";
};

export type DaySchedule = {
  date: string;
  items: ScheduleItem[];
  // Threads the auto-scheduler couldn't fit into the day.
  unscheduled: { threadId: string; title: string }[];
};

function nextSlot(ms: number): number {
  return Math.ceil(ms / SLOT_MS) * SLOT_MS;
}

// One UTC day for a user. Threads the user scheduled that day keep their time; unscheduled threads take the free
// 30-minute slots left in the workday, in the order given. Nothing is auto-placed in the past. The plan is
// computed on each read and not saved, so a future date shows where today's backlog would land if it were that day.
export function buildSchedule(threads: Thread[], date: string, nowMs: number): DaySchedule {
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  const workdayEnd = dayStart + WORKDAY_END_MS;
  const items: ScheduleItem[] = [];
  const unscheduled: DaySchedule["unscheduled"] = [];

  const busy = threads.flatMap((thread) => {
    const schedule = thread.schedule;
    return schedule !== null && schedule.startMs >= dayStart && schedule.startMs < dayStart + DAY
      ? [{ thread, ...schedule }]
      : [];
  });
  for (const { thread, startMs, endMs } of busy) {
    items.push({ threadId: thread.id, title: thread.title, startMs, endMs, source: "user" });
  }

  let slot = nextSlot(Math.max(dayStart + WORKDAY_START_MS, nowMs));
  for (const thread of threads) {
    if (thread.schedule !== null) continue;
    for (;;) {
      const slotEnd = slot + SLOT_MS;
      const clash = busy.find((block) => block.startMs < slotEnd && slot < block.endMs);
      if (clash === undefined) break;
      slot = nextSlot(clash.endMs);
    }
    if (slot + SLOT_MS > workdayEnd) {
      unscheduled.push({ threadId: thread.id, title: thread.title });
      continue;
    }
    items.push({
      threadId: thread.id,
      title: thread.title,
      startMs: slot,
      endMs: slot + SLOT_MS,
      source: "auto",
    });
    slot += SLOT_MS;
  }

  items.sort((a, b) => a.startMs - b.startMs);
  return { date, items, unscheduled };
}
