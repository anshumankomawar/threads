// Shared date and time formatting for threads.

export const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// "5m", "3h", "2d", "1mo" since the given time.
export function formatRelativeTime(atMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.floor((nowMs - atMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDue(dueAtMs: number, nowMs: number): { label: string; overdue: boolean } {
  if (dueAtMs < nowMs) return { label: "Overdue", overdue: true };
  const days = Math.round((startOfDay(dueAtMs) - startOfDay(nowMs)) / DAY);
  if (days === 0) return { label: "Due today", overdue: false };
  if (days === 1) return { label: "Due tomorrow", overdue: false };
  const date = new Date(dueAtMs);
  const formatted =
    days < 7
      ? date.toLocaleDateString(undefined, { weekday: "short" })
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label: `Due ${formatted}`, overdue: false };
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// A time typed in plain words: "3pm", "15:30", "tomorrow 10", "fri 2:30pm", "nov 5 4pm", "11/5 9am", "in 2h",
// "in 30 min", with an optional length ("for 45m", "for 1.5h"). A time without a day is the next time it comes
// round; a day without a time is 9 AM. Bare hours 1 to 7 mean the afternoon. Null when it isn't a time.
export function parseWhen(
  input: string,
  nowMs: number,
  defaultLengthMs: number,
): { startMs: number; endMs: number } | null {
  let text = ` ${input.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim()} `;
  if (text.trim() === "") return null;
  let lengthMs = defaultLengthMs;
  const take = (pattern: RegExp): RegExpMatchArray | null => {
    const match = text.match(pattern);
    if (match) text = text.replace(match[0], " ");
    return match;
  };

  const length = take(/ for (\d+(?:\.\d+)?) ?(m|min|mins|minutes?|h|hr|hrs|hours?) /);
  if (length) lengthMs = Number(length[1]) * (length[2].startsWith("h") ? 3_600_000 : 60_000);

  const relative = take(/ in (\d+(?:\.\d+)?) ?(m|min|mins|minutes?|h|hr|hrs|hours?) /);
  if (relative) {
    if (text.trim() !== "") return null;
    const startMs =
      nowMs + Number(relative[1]) * (relative[2].startsWith("h") ? 3_600_000 : 60_000);
    const rounded = Math.ceil(startMs / 300_000) * 300_000;
    return { startMs: rounded, endMs: rounded + lengthMs };
  }

  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  let dayGiven = false;
  if (take(/ (today|tonight) /)) dayGiven = true;
  else if (take(/ (tomorrow|tmrw|tmr) /)) {
    day.setDate(day.getDate() + 1);
    dayGiven = true;
  } else {
    const weekday = take(/ (?:next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]* /);
    const monthDay = weekday
      ? null
      : take(/ (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2}) /);
    const slashed = weekday || monthDay ? null : take(/ (\d{1,2})\/(\d{1,2}) /);
    if (weekday) {
      const ahead = (WEEKDAYS.indexOf(weekday[1]) - day.getDay() + 7) % 7 || 7;
      day.setDate(day.getDate() + ahead);
      dayGiven = true;
    } else if (monthDay || slashed) {
      const month = monthDay ? MONTHS.indexOf(monthDay[1]) : Number(slashed![1]) - 1;
      const date = Number(monthDay ? monthDay[2] : slashed![2]);
      if (month < 0 || month > 11 || date < 1 || date > 31) return null;
      day.setMonth(month, date);
      if (day.getTime() < new Date(nowMs).setHours(0, 0, 0, 0))
        day.setFullYear(day.getFullYear() + 1);
      dayGiven = true;
    }
  }

  let hour = 9;
  let minute = 0;
  const clock = take(/ (?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)? /);
  if (clock) {
    hour = Number(clock[1]);
    minute = clock[2] === undefined ? 0 : Number(clock[2]);
    const meridiem = clock[3]?.[0];
    if (hour > 23 || minute > 59 || (meridiem !== undefined && (hour < 1 || hour > 12)))
      return null;
    if (meridiem === "p" && hour < 12) hour += 12;
    else if (meridiem === "a" && hour === 12) hour = 0;
    else if (meridiem === undefined && clock[2] === undefined && hour >= 1 && hour <= 7) hour += 12;
  } else if (take(/ noon /)) hour = 12;
  else if (!dayGiven) return null;

  if (text.trim() !== "") return null;
  day.setHours(hour, minute, 0, 0);
  if (!dayGiven && day.getTime() <= nowMs) day.setDate(day.getDate() + 1);
  return { startMs: day.getTime(), endMs: day.getTime() + lengthMs };
}

// "Today, 3:00 PM", "Tomorrow, 10:00 AM", "Fri, 2:30 PM" or "Nov 5, 4:00 PM".
export function formatWhen(startMs: number, nowMs: number): string {
  const days = Math.round((startOfDay(startMs) - startOfDay(nowMs)) / DAY);
  const date = new Date(startMs);
  const dayLabel =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days > 1 && days < 7
          ? date.toLocaleDateString(undefined, { weekday: "short" })
          : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${dayLabel}, ${formatClock(startMs)}`;
}

// "10:00–11:30 AM", or "11:30 AM–1:00 PM" across noon: a block's start and end, saying AM/PM once when it can.
export function formatRange(startMs: number, endMs: number): string {
  const parts = (ms: number): { clock: string; period: string } => {
    const text = new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const match = text.match(/^(.*?)\s*([AaPp]\.?[Mm]\.?)$/);
    return match ? { clock: match[1], period: match[2] } : { clock: text, period: "" };
  };
  const start = parts(startMs);
  const end = parts(endMs);
  const startText =
    start.period !== "" && start.period === end.period
      ? start.clock
      : `${start.clock} ${start.period}`.trim();
  return `${startText}–${`${end.clock} ${end.period}`.trim()}`;
}
