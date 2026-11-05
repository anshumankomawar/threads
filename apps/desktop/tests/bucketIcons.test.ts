import { DEFAULT_BUCKETS } from "model";
import { expect, test } from "vite-plus/test";
import { bucketIcons } from "../src/renderer/src/bucketIcons";

const bucket = (id: string, name: string, description = "") => ({ id, name, description });

test("each bucket gets an icon from what it's about, and no two the same", () => {
  const buckets = [
    bucket("customers", "Customers"),
    bucket("bugs", "Incidents & bugs"),
    bucket("more-bugs", "Bugs again"),
    bucket("misc", "Odds and ends"),
    ...DEFAULT_BUCKETS,
  ];
  const icons = bucketIcons(buckets);
  expect(icons.size).toBe(buckets.length);
  expect(new Set(icons.values()).size).toBe(buckets.length);
  // A second bucket on a topic gets another icon rather than the same one.
  expect(icons.get("more-bugs")).not.toBe(icons.get("bugs"));
});
