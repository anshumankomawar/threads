import {
  threadFromCreate,
  type AnyRecord,
  type EntryRecord,
  type ModelName,
  type ThreadRecord,
} from "model";
import { expect, test } from "vite-plus/test";
import { migrateDescriptions, SyncEngine } from "../src/engine.ts";

const thread = (id: string, title: string): ThreadRecord =>
  threadFromCreate(
    { id, kind: "response", title, assigneeId: "arjun", attendeeIds: [], schedule: null },
    "anshu",
    10,
  );
const message = (
  id: string,
  threadId: string,
  text: string,
  createdAtMs = 10,
  authorId = "anshu",
): EntryRecord => ({
  id,
  threadId,
  kind: "message",
  authorId,
  text,
  createdAtMs,
});

test("stored threads get their opening message as their description, once", () => {
  const engine = new SyncEngine();
  const records: [ModelName, AnyRecord][] = [
    // Opened with the title then details; with just the title; with an ask that isn't the title (seeded samples).
    ["Thread", thread("t1", "Plan the offsite")],
    ["Entry", message("m1", "t1", "Plan the offsite\nSomewhere warm")],
    ["Thread", thread("t2", "Pricing")],
    ["Entry", message("m2", "t2", "Pricing")],
    ["Entry", message("m3", "t2", "Per seat?", 20)],
    ["Thread", thread("t3", "Review the PR")],
    ["Entry", message("m4", "t3", "Mind taking a look today?")],
    // A meeting, whose call link is made at the same moment as its agenda.
    ["Thread", { ...thread("t5", "Standup"), kind: "meeting" }],
    ["Entry", { id: "t5:call", threadId: "t5", kind: "call", link: "zoom", createdAtMs: 10 }],
    ["Entry", message("m6", "t5", "Standup\nBlockers first")],
    // Opened with messages moved in, which are older than the thread.
    ["Thread", thread("t4", "Branch")],
    ["Entry", message("m5", "t4", "From the parent", 5)],
  ];
  engine.load(
    records.map(([modelName, data]) => ({ modelName, data })),
    0,
  );
  migrateDescriptions(engine);
  const text = (id: string): string | undefined =>
    (engine.models.Entry.get(id) as { text: string } | undefined)?.text;
  expect([text("t1"), text("m1")]).toEqual(["Somewhere warm", undefined]);
  expect([text("t2"), text("m2"), text("m3")]).toEqual([undefined, undefined, "Per seat?"]);
  expect([text("t3"), text("m4")]).toEqual(["Mind taking a look today?", undefined]);
  expect([text("t4"), text("m5")]).toEqual([undefined, "From the parent"]);
  expect([text("t5"), text("m6")]).toEqual(["Blockers first", undefined]);

  const syncId = engine.lastSyncId;
  migrateDescriptions(engine);
  expect(engine.lastSyncId).toBe(syncId);
});
