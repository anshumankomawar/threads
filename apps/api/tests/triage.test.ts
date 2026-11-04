import { DEFAULT_BUCKETS, localPeople, type TransactionInput } from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import {
  seed,
  SyncEngine,
  transactionInput,
  type TriageRequest,
  type TriageResult,
} from "../src/engine.ts";
import { parseTriage, triagePrompt, Triager } from "../src/triage.ts";

const NOW = Date.UTC(2026, 10, 2, 8);

let engine: SyncEngine;
// Every request the fake model was asked, and how it answers: customer threads in the first bucket, the rest in the
// last.
let asked: TriageRequest[];
let failing: boolean;

const classify = async (request: TriageRequest): Promise<TriageResult[]> => {
  asked.push(request);
  if (failing) throw new Error("Model unavailable");
  return request.threads.map((thread) => ({
    threadId: thread.id,
    bucketId: /customer/i.test(thread.title) ? request.buckets[0].id : request.buckets.at(-1)!.id,
    reason: `About ${thread.title.toLowerCase()}`,
  }));
};

beforeEach(() => {
  engine = new SyncEngine({ now: () => NOW });
  seed(engine, "local", { id: "you", name: "You" }, NOW);
  asked = [];
  failing = false;
});

let counter = 0;
// Runs transactions as `actorId`, in their own session.
const run = (actorId: string, ...transactions: TransactionInput[]) =>
  engine.execute({ actorId, transactions }, { userId: actorId });
const create = (
  id: string,
  title: string,
  assigneeId: string | null = "arjun",
): TransactionInput => ({
  id: `tx-${++counter}`,
  type: "create",
  modelName: "Thread",
  data: { id, title, assigneeIds: assigneeId === null ? [] : [assigneeId] },
});
const update = (modelId: string, changes: object): TransactionInput =>
  ({
    id: `tx-${++counter}`,
    type: "update",
    modelName: "Thread",
    modelId,
    changes,
  }) as TransactionInput;
const setBuckets = (buckets: object[]): TransactionInput =>
  ({
    id: `tx-${++counter}`,
    type: "update",
    modelName: "Person",
    modelId: "arjun",
    changes: { buckets },
  }) as TransactionInput;
const triage = (id: string, personId = "arjun") => engine.models.Thread.get(id)?.triage[personId];
const send = (
  threadId: string,
  sentToIds: string[],
  text = "Can you take a look?",
): TransactionInput => ({
  id: `tx-${++counter}`,
  type: "create",
  modelName: "Entry",
  data: { id: `m-${counter}`, threadId, kind: "message", text, sentToIds },
});

test("new threads are sorted into the buckets of whoever they're waiting on", async () => {
  run("anshu", create("t1", "Customer can't log in"), create("t2", "Plan the offsite"));
  await new Triager(engine, classify).kick();
  expect(asked).toHaveLength(1);
  expect(asked[0].person.id).toBe("arjun");
  expect(asked[0].buckets).toEqual(DEFAULT_BUCKETS);
  expect(triage("t1")).toEqual({
    bucketId: "action",
    reason: "About customer can't log in",
    manual: false,
    stale: false,
  });
  expect(triage("t2")?.bucketId).toBe("read");
  // Sorted threads aren't asked about again.
  await new Triager(engine, classify).kick();
  expect(asked).toHaveLength(1);
});

test("a thread is sorted for someone newly assigned, and again when it's retitled, but not for other edits", async () => {
  run("anshu", create("t1", "Plan the offsite"));
  const triager = new Triager(engine, classify);
  await triager.kick();
  run("anshu", update("t1", { priority: "high" }));
  await triager.kick();
  expect(asked).toHaveLength(1);
  run("anshu", send("t1", ["kk"], "[[person:kk]] can you take this?"));
  await triager.kick();
  expect(asked[1].person.id).toBe("kk");
  expect(triage("t1", "kk")?.bucketId).toBe("read");
  run("anshu", update("t1", { title: "Customer offsite" }));
  // It stays where it was until the model has looked again.
  expect(triage("t1", "kk")).toMatchObject({ bucketId: "read", stale: true });
  await triager.kick();
  expect(triage("t1", "kk")).toMatchObject({ bucketId: "action", stale: false });
});

test("placing a thread by hand sticks, and becomes an example for the model", async () => {
  run("anshu", create("t1", "Customer can't log in"), create("t2", "Plan the offsite"));
  const triager = new Triager(engine, classify);
  await triager.kick();
  const manual = { bucketId: "read", reason: "", manual: true, stale: false };
  run("arjun", update("t1", { bucketId: "read" }));
  expect(triage("t1")).toEqual(manual);
  // Retitling keeps a hand-placed thread where it is.
  run("arjun", update("t1", { title: "Customer still can't log in" }));
  expect(triage("t1")).toEqual(manual);
  run("anshu", create("t3", "Review the launch plan"));
  await triager.kick();
  expect(asked.at(-1)?.examples).toEqual([
    { title: "Customer still can't log in", bucketId: "read" },
  ]);
  // Null hands it back to the model.
  run("arjun", update("t1", { bucketId: null }));
  await triager.kick();
  expect(triage("t1")).toMatchObject({ bucketId: "action", manual: false });
});

test("you place only what's in your inbox, into a bucket of yours", () => {
  run("anshu", create("t1", "Plan the offsite"));
  expect(() => run("kk", update("t1", { bucketId: "action" }))).toThrow(
    "Only a thread in your inbox",
  );
  expect(() => run("arjun", update("t1", { bucketId: "nope" }))).toThrow("Bucket not found");
  // Sending it to KK puts it in their inbox, so they can place it.
  run("anshu", send("t1", ["kk"]));
  run("kk", update("t1", { bucketId: "action" }));
  expect(triage("t1", "kk")?.manual).toBe(true);
});

test("new buckets sort the inbox again, keeping hand-placed threads whose bucket is still there", async () => {
  run("anshu", create("t1", "Customer can't log in"), create("t2", "Plan the offsite"));
  const triager = new Triager(engine, classify);
  await triager.kick();
  run("arjun", update("t1", { bucketId: "action" }));
  // Reordering changes nothing.
  run("arjun", setBuckets(DEFAULT_BUCKETS.toReversed()));
  expect(triage("t2")).toMatchObject({ bucketId: "read", stale: false });
  // A reworded bucket sorts again, with threads left where they are meanwhile.
  const reworded = DEFAULT_BUCKETS.map((bucket) =>
    bucket.id === "read" ? { ...bucket, description: "Admin and planning" } : bucket,
  );
  run("arjun", setBuckets(reworded));
  expect(triage("t2")).toMatchObject({ bucketId: "read", stale: true });
  expect(triage("t1")?.stale).toBe(false);
  await triager.kick();
  expect(triage("t2")?.stale).toBe(false);
  const mine = [...DEFAULT_BUCKETS.slice(0, 1), { id: "later", name: "Later", description: "" }];
  run("arjun", setBuckets(mine));
  expect(triage("t1")?.manual).toBe(true);
  // Its bucket is gone, so it waits to be sorted.
  expect(triage("t2")).toBeUndefined();
  await triager.kick();
  expect(asked.at(-1)?.buckets).toEqual(mine);
  expect(triage("t2")?.bucketId).toBe("later");
});

test("buckets need names and unique ids, and only you change yours", () => {
  const valid = (buckets: object[]): boolean =>
    transactionInput.safeParse(setBuckets(buckets)).success;
  expect(valid(DEFAULT_BUCKETS)).toBe(true);
  expect(valid([])).toBe(false);
  expect(valid([{ id: "a", name: "", description: "" }])).toBe(false);
  expect(
    valid([
      { id: "a", name: "A", description: "" },
      { id: "a", name: "B", description: "" },
    ]),
  ).toBe(false);
  const theirs = {
    id: "tx-theirs",
    type: "update",
    modelName: "Person",
    modelId: "kk",
    changes: { buckets: DEFAULT_BUCKETS },
  } as TransactionInput;
  expect(() => run("arjun", theirs)).toThrow("People change only their own profile");
});

test("a failing model leaves threads unsorted and waits before trying them again", async () => {
  let now = NOW;
  const retries: number[] = [];
  const triager = new Triager(engine, classify, {
    now: () => now,
    onFailure: (at) => retries.push(at),
  });
  run("anshu", create("t1", "Plan the offsite"));
  failing = true;
  await triager.kick();
  expect(triage("t1")).toBeUndefined();
  expect(retries).toEqual([NOW + 60_000]);
  failing = false;
  await triager.kick();
  expect(asked).toHaveLength(1);
  now += 60_000;
  await triager.kick();
  expect(triage("t1")?.bucketId).toBe("read");
});

test("a thread is sorted for everyone whose inbox it's in, but not once it's closed", async () => {
  run("anshu", create("t1", "Plan the offsite"), create("t2", "Old work"));
  run("anshu", update("t2", { status: "closed" }));
  run("arjun", send("t1", ["kk"], "Can you book the venue?"));
  const requests = engine.triageRequests();
  expect(requests.map((request) => [request.person.id, request.threads.map((t) => t.id)])).toEqual([
    ["arjun", ["t1"]],
    ["kk", ["t1"]],
  ]);
  // Who sent it to KK, and what, is what the model reads for them.
  expect(requests[1].threads[0]).toMatchObject({ from: "Arjun", text: "Can you book the venue?" });
  // The model answered for someone the thread is no longer in the inbox of: ignored.
  run("arjun", update("t1", { done: true }));
  engine.applyTriage("arjun", [{ threadId: "t1", bucketId: "read", reason: "" }]);
  expect(triage("t1")).toBeUndefined();
});

test("the prompt numbers buckets and threads, and answers map back to them", () => {
  run("anshu", create("t1", "Customer can't log in"));
  run("anshu", {
    id: "tx-desc",
    type: "create",
    modelName: "Entry",
    data: { id: "t1", threadId: "t1", kind: "message", text: "Since Tuesday's deploy" },
  });
  const [request] = engine.triageRequests();
  expect(request.threads[0]).toEqual({
    id: "t1",
    title: "Customer can't log in",
    from: localPeople().find((person) => person.id === "anshu")?.name,
    text: "Since Tuesday's deploy",
  });
  const prompt = triagePrompt(request);
  expect(prompt).toContain("1. Messages that require action:");
  expect(prompt).toContain("[1] Customer can't log in\nFrom: Anshu\nSince Tuesday's deploy");
  expect(
    parseTriage(
      request,
      '{"threads":[{"thread":1,"bucket":2,"reason":"Login broken"},{"thread":9,"bucket":1,"reason":""}]}',
    ),
  ).toEqual([{ threadId: "t1", bucketId: "read", reason: "Login broken" }]);
});
