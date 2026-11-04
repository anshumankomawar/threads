import type { TransactionInput } from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { seed, SyncEngine } from "../src/engine.ts";

const NOW = Date.UTC(2026, 10, 2, 8);

let engine: SyncEngine;
let counter = 0;

beforeEach(() => {
  engine = new SyncEngine({ now: () => NOW });
  seed(engine, "local", { id: "you", name: "You" }, NOW);
});

// Runs transactions as `actorId`, in their own session.
const run = (actorId: string, ...transactions: TransactionInput[]) =>
  engine.execute({ actorId, transactions }, { userId: actorId });
const create = (id: string, assigneeIds: string[] = []): TransactionInput => ({
  id: `tx-${++counter}`,
  type: "create",
  modelName: "Thread",
  data: { id, title: "Review the CR", assigneeIds },
});
const send = (threadId: string, text: string, sentToIds: string[] = []): TransactionInput => ({
  id: `tx-${++counter}`,
  type: "create",
  modelName: "Entry",
  data: { id: `m-${counter}`, threadId, kind: "message", text, sentToIds },
});
const thread = (id: string) => engine.models.Thread.get(id);

test("whoever makes a thread owns it, with whoever they picked assigned", () => {
  run("anshu", create("t1", ["arjun"]));
  expect(thread("t1")).toMatchObject({ createdById: "anshu", assigneeIds: ["arjun"] });
});

test("@mentioning people in a message assigns them, once each, leaving unknown mentions as text", () => {
  run("anshu", create("t1", ["arjun"]));
  run(
    "anshu",
    send("t1", "[[person:arjun]] [[person:kk]] [[person:nobody]] can you review?", ["arjun", "kk"]),
  );
  expect(thread("t1")?.assigneeIds).toEqual(["arjun", "kk"]);
  // Anyone can bring someone in.
  run("kk", send("t1", "[[person:omar]] can you help?", ["omar"]));
  expect(thread("t1")?.assigneeIds).toEqual(["arjun", "kk", "omar"]);
});

test("@mentioning a group assigns it through its label", () => {
  run("anshu", {
    id: "tx-group",
    type: "create",
    modelName: "Group",
    data: { id: "g1", name: "Backend", memberIds: ["arjun", "kk"] },
  });
  const labelId = engine.models.Group.get("g1")?.labelId;
  run("anshu", create("t1"));
  run("anshu", send("t1", "[[group:g1]] can everyone fill this in?", ["arjun", "kk"]));
  expect(thread("t1")?.labelIds).toEqual([labelId]);
  expect(thread("t1")?.assigneeIds).toEqual([]);
});

test("only its owner writes a thread's description", () => {
  run("anshu", create("t1", ["arjun"]));
  expect(() =>
    run("arjun", {
      id: "tx-desc",
      type: "create",
      modelName: "Entry",
      data: { id: "t1", threadId: "t1", kind: "message", text: "Mine now" },
    }),
  ).toThrow("Only whoever opened a thread writes its description");
});
