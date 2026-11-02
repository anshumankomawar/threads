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
// Every request the fake model was asked, and how it answers: by keyword in the title.
let asked: TriageRequest[];
let failing: boolean;

const classify = async (request: TriageRequest): Promise<TriageResult[]> => {
  asked.push(request);
  if (failing) throw new Error("Model unavailable");
  return request.threads.map((thread) => ({
    threadId: thread.id,
    bucketId: /customer/i.test(thread.title)
      ? (request.buckets.find((bucket) => bucket.name.includes("Customer"))?.id ?? "other")
      : request.buckets.at(-1)!.id,
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
const run = (actorId: string, ...transactions: TransactionInput[]) =>
  engine.execute(actorId, transactions);
const create = (
  id: string,
  title: string,
  assigneeId: string | null = "arjun",
): TransactionInput => ({
  id: `tx-${++counter}`,
  type: "create",
  modelName: "Thread",
  data: { id, kind: "issue", title, assigneeId, attendeeIds: [] },
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
const triage = (id: string) => engine.models.Thread.get(id)?.triage;

test("new threads are sorted into the buckets of whoever they're waiting on", async () => {
  run("anshu", create("t1", "Customer can't log in"), create("t2", "Plan the offsite"));
  await new Triager(engine, classify).kick();
  expect(asked).toHaveLength(1);
  expect(asked[0].person.id).toBe("arjun");
  expect(asked[0].buckets).toEqual(DEFAULT_BUCKETS);
  expect(triage("t1")).toEqual({
    personId: "arjun",
    bucketId: "customers",
    reason: "About customer can't log in",
    manual: false,
    stale: false,
  });
  expect(triage("t2")?.bucketId).toBe("other");
  // Sorted threads aren't asked about again.
  await new Triager(engine, classify).kick();
  expect(asked).toHaveLength(1);
});

test("a thread is sorted again when it changes hands or is retitled, but not for other edits", async () => {
  run("anshu", create("t1", "Plan the offsite"));
  const triager = new Triager(engine, classify);
  await triager.kick();
  run("anshu", update("t1", { priority: "high" }));
  await triager.kick();
  expect(asked).toHaveLength(1);
  run("anshu", update("t1", { assigneeId: "kk" }));
  await triager.kick();
  expect(asked[1].person.id).toBe("kk");
  expect(triage("t1")?.personId).toBe("kk");
  run("anshu", update("t1", { title: "Customer offsite" }));
  // It stays where it was until the model has looked again.
  expect(triage("t1")).toMatchObject({ bucketId: "other", stale: true });
  await triager.kick();
  expect(triage("t1")).toMatchObject({ personId: "kk", bucketId: "customers" });
});

test("placing a thread by hand sticks, and becomes an example for the model", async () => {
  run("anshu", create("t1", "Customer can't log in"), create("t2", "Plan the offsite"));
  const triager = new Triager(engine, classify);
  await triager.kick();
  const manual = { personId: "arjun", bucketId: "bugs", reason: "", manual: true, stale: false };
  run("arjun", update("t1", { triage: manual }));
  expect(triage("t1")).toEqual(manual);
  // Retitling keeps a hand-placed thread where it is.
  run("arjun", update("t1", { title: "Customer still can't log in" }));
  expect(triage("t1")).toEqual(manual);
  run("anshu", create("t3", "Review the launch plan"));
  await triager.kick();
  expect(asked.at(-1)?.examples).toEqual([
    { title: "Customer still can't log in", bucketId: "bugs" },
  ]);
  // Null hands it back to the model.
  run("arjun", update("t1", { triage: null }));
  await triager.kick();
  expect(triage("t1")).toMatchObject({ bucketId: "customers", manual: false });
});

test("only whoever a thread waits on places it, in a bucket of theirs", () => {
  run("anshu", create("t1", "Plan the offsite"));
  const into = (personId: string, bucketId: string) =>
    update("t1", { triage: { personId, bucketId, reason: "", manual: true, stale: false } });
  expect(() => run("kk", into("kk", "bugs"))).toThrow("Only an open thread in your inbox");
  expect(() => run("arjun", into("kk", "bugs"))).toThrow("People sort only their own inbox");
  expect(() => run("arjun", into("arjun", "nope"))).toThrow("Bucket not found");
});

test("new buckets sort the inbox again, keeping hand-placed threads whose bucket is still there", async () => {
  run("anshu", create("t1", "Customer can't log in"), create("t2", "Plan the offsite"));
  const triager = new Triager(engine, classify);
  await triager.kick();
  run(
    "arjun",
    update("t1", {
      triage: { personId: "arjun", bucketId: "customers", reason: "", manual: true, stale: false },
    }),
  );
  // Reordering changes nothing.
  run("arjun", setBuckets(DEFAULT_BUCKETS.toReversed()));
  expect(triage("t2")).toMatchObject({ bucketId: "other", stale: false });
  // A reworded bucket sorts again, with threads left where they are meanwhile.
  const reworded = DEFAULT_BUCKETS.map((bucket) =>
    bucket.id === "other" ? { ...bucket, description: "Admin and planning" } : bucket,
  );
  run("arjun", setBuckets(reworded));
  expect(triage("t2")).toMatchObject({ bucketId: "other", stale: true });
  expect(triage("t1")?.stale).toBe(false);
  await triager.kick();
  expect(triage("t2")?.stale).toBe(false);
  const mine = [...DEFAULT_BUCKETS.slice(0, 1), { id: "later", name: "Later", description: "" }];
  run("arjun", setBuckets(mine));
  expect(triage("t1")?.manual).toBe(true);
  // Its bucket is gone, so it waits to be sorted.
  expect(triage("t2")).toBeNull();
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
  expect(() => engine.execute("arjun", [theirs])).toThrow("People change only their own profile");
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
  expect(triage("t1")).toBeNull();
  expect(retries).toEqual([NOW + 60_000]);
  failing = false;
  await triager.kick();
  expect(asked).toHaveLength(1);
  now += 60_000;
  await triager.kick();
  expect(triage("t1")?.bucketId).toBe("other");
});

test("closed threads, conversations and threads that moved on aren't sorted", async () => {
  run("anshu", create("t1", "Plan the offsite"));
  run("anshu", {
    id: "tx-chat",
    type: "create",
    modelName: "Thread",
    data: {
      id: "c1",
      kind: "conversation",
      title: "Quick q",
      assigneeId: null,
      attendeeIds: ["kk"],
      branchedFromId: "t1",
    },
  });
  run("anshu", create("t2", "Old work"), update("t2", { status: "closed" }));
  const [request] = engine.triageRequests();
  expect(request.threads.map((thread) => thread.id)).toEqual(["t1"]);
  // The model answered for someone the thread no longer waits on: ignored.
  run("anshu", update("t1", { assigneeId: "kk" }));
  engine.applyTriage("arjun", [{ threadId: "t1", bucketId: "other", reason: "" }]);
  expect(triage("t1")).toBeNull();
});

test("the prompt numbers buckets and threads, and answers map back to them", () => {
  run("anshu", create("t1", "Customer can't log in"));
  engine.execute("anshu", [
    {
      id: "tx-desc",
      type: "create",
      modelName: "Entry",
      data: { id: "t1", threadId: "t1", kind: "message", text: "Since Tuesday's deploy" },
    },
  ]);
  const [request] = engine.triageRequests();
  expect(request.threads[0]).toEqual({
    id: "t1",
    title: "Customer can't log in",
    from: localPeople().find((person) => person.id === "anshu")?.name,
    text: "Since Tuesday's deploy",
  });
  const prompt = triagePrompt(request);
  expect(prompt).toContain("1. Customer requests:");
  expect(prompt).toContain("[1] Customer can't log in\nFrom: Anshu\nSince Tuesday's deploy");
  expect(
    parseTriage(
      request,
      '{"threads":[{"thread":1,"bucket":2,"reason":"Login broken"},{"thread":9,"bucket":1,"reason":""}]}',
    ),
  ).toEqual([{ threadId: "t1", bucketId: "bugs", reason: "Login broken" }]);
});
