// Dates as they're typed: "today", "tomorrow", "fri", "next week", "in 3 days", "2w", "mar 14", "14 march",
// "3/14", "2026-03-14", "eow"; and a span between two of them ("mon to fri", "today - mar 3"). Each is a day, at
// midnight local; a day that's passed this year is next year's.

export type When = { start: Date; end: Date };

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const UNITS: Record<string, "d" | "w" | "m"> = {
  d: "d",
  day: "d",
  w: "w",
  wk: "w",
  week: "w",
  m: "m",
  mo: "m",
  month: "m",
};

const day = (date: Date, add = 0): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + add);
const prefix = (word: string, names: string[]): number =>
  word.length >= 3 ? names.findIndex((name) => word.startsWith(name)) : -1;

// One day, from its words, or null if they aren't one.
export function parseDay(text: string, now = new Date()): Date | null {
  const today = day(now);
  const words = text.trim().toLowerCase().replace(/[,.]/g, " ").split(/\s+/).filter(Boolean);
  const said = words.join(" ");
  if (!said) return null;

  if (["today", "tod", "now"].includes(said)) return today;
  if (["tomorrow", "tom", "tmr", "tmrw"].includes(said)) return day(today, 1);
  if (said === "yesterday") return day(today, -1);
  if (["next week", "nw"].includes(said)) return day(today, (8 - today.getDay()) % 7 || 7);
  if (["next month", "nm"].includes(said))
    return new Date(today.getFullYear(), today.getMonth() + 1, 1);
  if (["eow", "end of week", "this week"].includes(said))
    return day(today, (5 - today.getDay() + 7) % 7);
  if (["eom", "end of month", "this month"].includes(said))
    return new Date(today.getFullYear(), today.getMonth() + 1, 0);

  // "fri", "this fri", "next fri": the next one, today included; "next" a week on.
  const weekday = said.match(/^(this |next )?([a-z]+)$/);
  if (weekday) {
    const index = prefix(weekday[2], DAYS);
    if (index >= 0) {
      const ahead = (index - today.getDay() + 7) % 7;
      return day(today, ahead + (weekday[1] === "next " ? 7 : 0));
    }
  }

  // "in 3 days", "3d", "+2w", "in a week".
  const offset = said.match(/^(?:in |\+)?(\d+|a|an) ?([a-z]+)$/);
  if (offset && UNITS[offset[2].replace(/s$/, "")]) {
    const count = /^\d/.test(offset[1]) ? Number(offset[1]) : 1;
    const unit = UNITS[offset[2].replace(/s$/, "")];
    if (unit === "m")
      return new Date(today.getFullYear(), today.getMonth() + count, today.getDate());
    return day(today, count * (unit === "w" ? 7 : 1));
  }

  // "2026-03-14".
  const iso = said.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return valid(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  // "3/14", "3/14/27".
  const slash = said.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) return dated(Number(slash[1]) - 1, Number(slash[2]), slash[3], today);

  // "mar 14", "march 14 2027", "14 mar".
  const parts = said.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/);
  const flipped = said.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/);
  const [month, date, year] = parts
    ? [parts[1], parts[2], parts[3]]
    : flipped
      ? [flipped[2], flipped[1], flipped[3]]
      : [];
  if (month) {
    const index = prefix(month, MONTHS);
    if (index >= 0) return dated(index, Number(date), year, today);
  }

  // "14": that day this month, or next.
  const alone = said.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  if (alone) {
    const n = Number(alone[1]);
    const here = valid(today.getFullYear(), today.getMonth(), n);
    if (here && here >= today) return here;
    return valid(today.getFullYear(), today.getMonth() + 1, n);
  }
  return null;
}

// A day or a span: "fri", "mon to fri", "today - mar 3". The end's never before the start.
export function parseWhen(text: string, now = new Date()): When | null {
  const [first, second, ...rest] = text.split(/\s+(?:to|until|till|through|-|–|—)\s+/i);
  if (rest.length > 0) return null;
  const start = parseDay(first, now);
  if (!start) return null;
  if (second === undefined) return { start, end: start };
  const end = parseDay(second, start);
  return end && end >= start ? { start, end } : null;
}

// What was understood, to show as it's typed: "Fri, Mar 14", or "Mar 10 – Mar 14".
export function describeWhen(when: When, now = new Date()): string {
  const one = (date: Date): string =>
    date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
    });
  return when.start.getTime() === when.end.getTime()
    ? one(when.start)
    : `${one(when.start)} – ${one(when.end)}`;
}

function valid(year: number, month: number, date: number): Date | null {
  const made = new Date(year, month, date);
  return made.getMonth() === ((month % 12) + 12) % 12 && made.getDate() === date ? made : null;
}

// A month and day, in the year given, or the next time it comes round.
function dated(month: number, date: number, year: string | undefined, today: Date): Date | null {
  if (year) return valid(year.length === 2 ? 2000 + Number(year) : Number(year), month, date);
  const here = valid(today.getFullYear(), month, date);
  if (here && here >= today) return here;
  return valid(today.getFullYear() + 1, month, date);
}
