import type { SyncAction, Thread, TransactionInput } from "model";
import { toThreads } from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";

// A fixed clock: Monday 2026-11-02, 08:00 UTC.
const NOW = Date.UTC(2026, 10, 2, 8);
const at = (hour: number, minute = 0): number => Date.UTC(2026, 10, 2, hour, minute);

let app: ReturnType<typeof createApp>;
let clock: number;

beforeEach(() => {
  clock = NOW;
  app = createApp({ now: () => clock });
});

type Bootstrap = {
  lastSyncId: number;
  schemaHash: string;
  models: { Person: { id: string; managerId?: string }[]; Thread: never[]; Entry: never[] };
};

function send(method: string, path: string, body?: unknown, workspace = "local") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Workspace": workspace },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const bootstrap = async (workspace = "local"): Promise<Bootstrap> =>
  (await send("GET", "/sync/bootstrap", undefined, workspace)).json() as Promise<Bootstrap>;

const deltas = async (after: number): Promise<SyncAction[]> =>
  ((await (await send("GET", `/sync/deltas?after=${after}`)).json()) as { actions: SyncAction[] })
    .actions;

// Runs a batch as `actorId` and returns the response.
const transact = (actorId: string, transactions: TransactionInput[], utcOffsetMinutes?: number) =>
  send("POST", "/sync/transactions", { actorId, utcOffsetMinutes, transactions });

// The workspace's threads as the app renders them, rebuilt from a bootstrap.
async function threads(): Promise<Thread[]> {
  const { models } = (await (await send("GET", "/sync/bootstrap")).json()) as {
    models: { Person: []; Thread: []; Entry: [] };
  };
  return toThreads(
    models.Thread,
    models.Entry,
    new Map((models.Person as { id: string }[]).map((person) => [person.id, person as never])),
  );
}

const thread = async (id: string): Promise<Thread | undefined> =>
  (await threads()).find((candidate) => candidate.id === id);

let counter = 0;
const txId = (): string => `tx-${++counter}`;

const createThread = (
  id: string,
  fields: Partial<{
    kind: string;
    title: string;
    assigneeId: string | null;
    attendeeIds: string[];
  }> = {},
): TransactionInput =>
  ({
    id: txId(),
    type: "create",
    modelName: "Thread",
    data: {
      id,
      kind: "response",
      title: "Plan the offsite",
      assigneeId: "arjun",
      attendeeIds: [],
      schedule: null,
      ...fields,
    },
  }) as TransactionInput;

const message = (id: string, threadId: string, text = "Plan the offsite"): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Entry",
  data: { id, threadId, kind: "message", text },
});

const update = (threadId: string, changes: object): TransactionInput =>
  ({
    id: txId(),
    type: "update",
    modelName: "Thread",
    modelId: threadId,
    changes,
  }) as TransactionInput;

// --- Bootstrap and workspaces ---

test("bootstrap returns every model and the sync id it's current to", async () => {
  const body = await bootstrap();
  expect(body.models.Person.map((person) => person.id)).toEqual(["anshu", "arjun", "kk"]);
  expect(body.models.Person[0].managerId).toBe("kk");
  expect(body.models.Thread).toEqual([]);
  expect(body.lastSyncId).toBe(3);
  expect(body.schemaHash).toEqual(expect.any(String));
});

test("the sample workspace has the demo team and their threads", async () => {
  const body = await bootstrap("sample");
  expect(body.models.Person[0]).toMatchObject({ id: "you", managerId: "priya" });
  expect(body.models.Thread.length).toBeGreaterThan(10);
  expect((await send("GET", "/sync/bootstrap", undefined, "nope")).status).toBe(400);
});

// --- Transactions and side effects ---

test("a new thread and its opening message become one ordered batch of sync actions", async () => {
  const { lastSyncId } = await bootstrap();
  const response = await transact("anshu", [createThread("t1"), message("m1", "t1")]);
  expect(await response.json()).toEqual({ lastSyncId: lastSyncId + 2 });
  // One action per model per batch: the message's bump to the thread folds into the thread's insert.
  expect(
    (await deltas(lastSyncId)).map((action) => [action.id, action.modelName, action.action]),
  ).toEqual([
    [lastSyncId + 1, "Thread", "I"],
    [lastSyncId + 2, "Entry", "I"],
  ]);
  expect(await thread("t1")).toMatchObject({
    kind: "response",
    title: "Plan the offsite",
    requester: { id: "anshu" },
    assignee: { id: "arjun" },
    status: "open",
    updatedAtMs: NOW,
    entries: [{ kind: "message", author: { id: "anshu" }, createdAtMs: NOW }],
  });
});

test("a meeting includes its creator and invitees and gets a call link after its agenda", async () => {
  await transact("anshu", [
    createThread("t1", { kind: "meeting", assigneeId: null, attendeeIds: ["arjun", "kk"] }),
    message("m1", "t1", "Pricing sync"),
  ]);
  expect(await thread("t1")).toMatchObject({
    attendees: [{ id: "anshu" }, { id: "arjun" }, { id: "kk" }],
    assignee: null,
    entries: [
      { kind: "message", text: "Pricing sync" },
      { kind: "call", link: expect.any(String) },
    ],
  });
});

test("a focus block is the creator's own work", async () => {
  await transact("anshu", [createThread("t1", { kind: "focus", assigneeId: null })]);
  expect((await thread("t1"))?.assignee?.id).toBe("anshu");
});

test("updates record an activity line for each real change, in the actor's words", async () => {
  await transact("anshu", [createThread("t1"), message("m1", "t1")]);
  clock = NOW + 1000;
  await transact("arjun", [update("t1", { status: "in_progress", priority: "high" })]);
  await transact("arjun", [update("t1", { status: "in_progress" })]);
  await transact("arjun", [update("t1", { assigneeId: "arjun" })]);
  await transact("arjun", [update("t1", { assigneeId: "kk" })]);
  const result = await thread("t1");
  expect(result).toMatchObject({
    status: "in_progress",
    priority: "high",
    updatedAtMs: NOW + 1000,
  });
  expect(
    result?.entries.filter((entry) => entry.kind === "event").map((entry) => entry.text),
  ).toEqual(["changed status to In progress", "set priority to High", "assigned this to KK"]);
});

test("a resolution closes the thread, and reopening says so", async () => {
  await transact("anshu", [createThread("t1"), message("m1", "t1")]);
  await transact("arjun", [
    {
      id: txId(),
      type: "create",
      modelName: "Entry",
      data: { id: "r1", threadId: "t1", kind: "resolution", text: "Shipped" },
    },
  ]);
  expect((await thread("t1"))?.status).toBe("done");
  await transact("anshu", [update("t1", { status: "open" })]);
  expect((await thread("t1"))?.entries.at(-1)).toMatchObject({
    kind: "event",
    text: "reopened this",
  });
});

test("activity lines read in the actor's time zone", async () => {
  await transact("anshu", [createThread("t1")]);
  await transact(
    "anshu",
    [update("t1", { schedule: { startMs: at(17), endMs: at(17, 30) } })],
    -420,
  );
  // 17:00 UTC is 10:00 AM at UTC−7.
  expect((await thread("t1"))?.entries.at(-1)).toMatchObject({
    text: "scheduled this for Mon 10:00 AM",
  });
});

// --- Guarantees ---

test("a resent transaction runs only once", async () => {
  const { lastSyncId } = await bootstrap();
  const batch = [createThread("t1")];
  await transact("anshu", batch);
  expect(await (await transact("anshu", batch)).json()).toEqual({ lastSyncId: lastSyncId + 1 });
});

test("a batch with a bad transaction changes nothing", async () => {
  const { lastSyncId } = await bootstrap();
  const response = await transact("anshu", [
    createThread("t1"),
    update("missing", { priority: "high" }),
  ]);
  expect(response.status).toBe(404);
  expect(await deltas(lastSyncId)).toEqual([]);
  expect(await thread("t1")).toBeUndefined();
});

test.each([
  ["an unknown actor", "nobody", [createThread("t2")], 404],
  ["an unknown assignee", "anshu", [createThread("t2", { assigneeId: "nobody" })], 404],
  [
    "an unknown invitee",
    "anshu",
    [createThread("t2", { kind: "meeting", attendeeIds: ["nobody"] })],
    404,
  ],
  ["a duplicate thread id", "anshu", [createThread("t1")], 409],
  ["a misspelled field", "anshu", [update("t1", { statuss: "done" })], 400],
  ["a bad status", "anshu", [update("t1", { status: "closed" })], 400],
  ["a backwards schedule", "anshu", [update("t1", { schedule: { startMs: 2, endMs: 1 } })], 400],
])("rejects %s", async (_, actorId, transactions, status) => {
  await transact("anshu", [createThread("t1")]);
  expect((await transact(actorId as string, transactions as TransactionInput[])).status).toBe(
    status,
  );
});

test("a thread can branch off another, which must exist", async () => {
  await transact("anshu", [createThread("t1"), message("m1", "t1")]);
  await transact(
    "anshu",
    [createThread("t2", { title: "Side discussion" }), message("m2", "t2", "Side discussion")].map(
      (transaction) =>
        transaction.type === "create" && transaction.modelName === "Thread"
          ? { ...transaction, data: { ...transaction.data, branchedFromId: "t1" } }
          : transaction,
    ),
  );
  expect((await thread("t2"))?.branchedFromId).toBe("t1");
  expect((await thread("t1"))?.branchedFromId).toBeNull();
  const orphan = createThread("t3");
  expect(
    (
      await transact("anshu", [
        {
          ...orphan,
          data: { ...(orphan as { data: object }).data, branchedFromId: "missing" },
        } as TransactionInput,
      ])
    ).status,
  ).toBe(404);
});

test("messages move to another thread, leaving an activity line where they were", async () => {
  await transact("anshu", [
    createThread("t1"),
    message("m1", "t1", "Plan the offsite"),
    message("m2", "t1", "What about pricing?"),
    message("m3", "t1", "Pricing should be per seat"),
  ]);
  await transact("arjun", [
    createThread("t2", { title: "Pricing" }),
    { id: "move-1", type: "move", modelName: "Entry", entryIds: ["m2", "m3"], threadId: "t2" },
  ]);
  const source = await thread("t1");
  expect(source?.entries.map((entry) => entry.kind)).toEqual(["message", "event"]);
  expect(source?.entries[1]).toMatchObject({
    kind: "event",
    actor: { id: "arjun" },
    text: "moved 2 messages to [[thread:t2]]",
  });
  const destination = await thread("t2");
  expect(
    destination?.entries.flatMap((entry) => (entry.kind === "message" ? [entry.id] : [])),
  ).toEqual(["m2", "m3"]);
  // Only messages, from one thread, to a different existing thread.
  const move = (entryIds: string[], threadId: string): TransactionInput => ({
    id: txId(),
    type: "move",
    modelName: "Entry",
    entryIds,
    threadId,
  });
  expect((await transact("anshu", [move(["m1"], "missing")])).status).toBe(404);
  expect((await transact("anshu", [move(["m1", "m2"], "t2")])).status).toBe(400);
  expect((await transact("anshu", [move(["m2"], "t2")])).status).toBe(400);
  // Not into a thread the message links to.
  await transact("anshu", [message("m4", "t1", "See [[thread:t2]]")]);
  expect((await transact("anshu", [move(["m4"], "t2")])).status).toBe(400);
});
