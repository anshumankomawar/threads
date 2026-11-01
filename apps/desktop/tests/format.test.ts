import { expect, test } from "vite-plus/test";
import { formatRange, parseWhen } from "../src/renderer/src/format";

// Monday 2026-11-02, 11:00 local.
const NOW = new Date(2026, 10, 2, 11).getTime();
const HALF_HOUR = 30 * 60_000;
const at = (month: number, date: number, hour: number, minute = 0): number =>
  new Date(2026, month, date, hour, minute).getTime();
const start = (text: string): number | undefined => parseWhen(text, NOW, HALF_HOUR)?.startMs;

test.each<[string, number]>([
  ["3pm", at(10, 2, 15)],
  ["3", at(10, 2, 15)],
  ["15:30", at(10, 2, 15, 30)],
  ["10am", at(10, 3, 10)],
  ["tomorrow", at(10, 3, 9)],
  ["tomorrow 10:30", at(10, 3, 10, 30)],
  ["fri 2:30pm", at(10, 6, 14, 30)],
  ["Friday at 9", at(10, 6, 9)],
  ["mon 9am", at(10, 9, 9)],
  ["nov 5 4pm", at(10, 5, 16)],
  ["11/5 9am", at(10, 5, 9)],
  ["today noon", at(10, 2, 12)],
  ["in 2h", at(10, 2, 13)],
])("%s", (text, expected) => {
  expect(start(text)).toBe(expected);
});

test("a length can follow", () => {
  const when = parseWhen("tomorrow 2pm for 45m", NOW, HALF_HOUR);
  expect(when).toEqual({ startMs: at(10, 3, 14), endMs: at(10, 3, 14, 45) });
});

test.each(["", "lunch", "25:00", "13pm", "tomorrow banana"])("not a time: %j", (text) => {
  expect(parseWhen(text, NOW, HALF_HOUR)).toBeNull();
});

test("a range says AM or PM once when both ends share it", () => {
  const range = formatRange(at(10, 2, 10), at(10, 2, 11, 30));
  expect(range).toMatch(/^10:00\s?–\s?11:30\s?AM$/);
  expect(formatRange(at(10, 2, 11, 30), at(10, 2, 13))).toMatch(/^11:30\sAM–1:00\sPM$/);
});
