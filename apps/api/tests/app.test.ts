import { SCHEMA_HASH } from "model";
import { decodeBootstrap } from "sync";
import type { SyncAction, Thread, TransactionInput } from "model";
import { localPeople, toThreads } from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";

// A fixed clock: Monday 2026-11-02, 08:00 UTC.
const NOW = Date.UTC(2026, 10, 2, 8);

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
  decodeBootstrap(
    await (await send("GET", "/sync/bootstrap", undefined, workspace)).text(),
  ) as never as Bootstrap;

const deltas = async (after: number): Promise<SyncAction[]> =>
  ((await (await send("GET", `/sync/deltas?after=${after}`)).json()) as { actions: SyncAction[] })
    .actions;

// Runs a batch as `actorId` and returns the response.
const transact = (actorId: string, transactions: TransactionInput[], utcOffsetMinutes?: number) =>
  send("POST", "/sync/transactions", {
    actorId,
    utcOffsetMinutes,
    schemaHash: SCHEMA_HASH,
    transactions,
  });

// The workspace's threads as the app renders them, rebuilt from a bootstrap.
async function threads(): Promise<Thread[]> {
  const { models } = decodeBootstrap(
    await (await send("GET", "/sync/bootstrap")).text(),
  ) as never as {
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
    title: string;
    assigneeIds: string[];
    branchedFromId: string;
  }> = {},
): TransactionInput =>
  ({
    id: txId(),
    type: "create",
    modelName: "Thread",
    data: {
      id,
      title: "Plan the offsite",
      assigneeIds: ["arjun"],
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
  const people = localPeople();
  expect(body.models.Person.map((person) => person.id)).toEqual(people.map((person) => person.id));
  expect(body.models.Person[0].managerId).toBe("kk");
  expect(body.models.Thread).toEqual([]);
  expect(body.lastSyncId).toBeGreaterThanOrEqual(people.length);
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
    title: "Plan the offsite",
    owner: { id: "anshu" },
    assignees: [{ id: "arjun" }],
    status: "open",
    updatedAtMs: NOW,
    entries: [{ kind: "message", author: { id: "anshu" }, createdAtMs: NOW }],
  });
});

test("a thread's description shares its id, is written by whoever opened it, and stays when messages move", async () => {
  await transact("anshu", [createThread("t1"), message("t1", "t1", "Somewhere warm")]);
  expect((await thread("t1"))?.entries).toMatchObject([{ id: "t1", text: "Somewhere warm" }]);
  await transact("anshu", [createThread("t2", { title: "Pricing" })]);
  // Only by whoever opened it, only as a message, and no entry takes another thread's id.
  expect((await transact("arjun", [message("t2", "t2")])).status).toBe(403);
  expect(
    (
      await transact("anshu", [
        {
          id: txId(),
          type: "create",
          modelName: "Entry",
          data: { id: "t2", threadId: "t2", kind: "resolution", text: "Done" },
        },
      ])
    ).status,
  ).toBe(400);
  expect((await transact("anshu", [message("t1", "t2")])).status).toBe(409);
  expect((await transact("anshu", [message("t2", "t1")])).status).toBe(400);
  expect(
    (
      await transact("anshu", [
        { id: txId(), type: "move", modelName: "Entry", entryIds: ["t1"], threadId: "t2" },
      ])
    ).status,
  ).toBe(400);
});

// --- Notes and sending ---

const sendTo = (
  id: string,
  threadId: string,
  sentToIds: string[],
  text = "Can you look?",
): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Entry",
  data: { id, threadId, kind: "message", text, sentToIds },
});

test("a message is a note unless it's sent to people, who must exist", async () => {
  await transact("anshu", [createThread("t1"), message("m1", "t1", "Notes for later")]);
  await transact("anshu", [sendTo("m2", "t1", ["kk", "anshu"])]);
  const [note, sent] = (await thread("t1"))?.entries ?? [];
  expect(note).toMatchObject({ kind: "message", sentTo: [] });
  // Sending to yourself is just a note to them.
  expect(sent).toMatchObject({ kind: "message", sentTo: [{ id: "kk" }] });
  expect((await transact("anshu", [sendTo("m3", "t1", ["nobody"])])).status).toBe(404);
  const resolution = {
    id: txId(),
    type: "create",
    modelName: "Entry",
    data: { id: "r1", threadId: "t1", kind: "resolution", text: "Done", sentToIds: ["kk"] },
  } as TransactionInput;
  expect((await transact("anshu", [resolution])).status).toBe(400);
});

test("done and snoozed are each person's own, and quiet", async () => {
  await transact("anshu", [createThread("t1"), sendTo("m1", "t1", ["kk"])]);
  const before = (await thread("t1"))?.updatedAtMs;
  clock = NOW + 1000;
  await transact("kk", [update("t1", { done: true })]);
  await transact("arjun", [update("t1", { snoozeUntilMs: NOW + 60_000 })]);
  const after = await thread("t1");
  expect(after).toMatchObject({
    doneBy: { kk: NOW + 1000 },
    snoozedUntil: { arjun: NOW + 60_000 },
    updatedAtMs: before,
  });
  expect(after?.entries.filter((entry) => entry.kind === "event")).toEqual([]);
  await transact("kk", [update("t1", { done: false })]);
  await transact("arjun", [update("t1", { snoozeUntilMs: null })]);
  expect(await thread("t1")).toMatchObject({ doneBy: {}, snoozedUntil: {} });
});

test("updates record an activity line for each real change, in the actor's words", async () => {
  await transact("anshu", [createThread("t1"), message("m1", "t1")]);
  clock = NOW + 1000;
  await transact("arjun", [update("t1", { status: "blocked", priority: "high" })]);
  await transact("arjun", [update("t1", { status: "blocked" })]);

  const result = await thread("t1");
  expect(result).toMatchObject({
    status: "blocked",
    priority: "high",
    updatedAtMs: NOW + 1000,
  });
  expect(
    result?.entries.filter((entry) => entry.kind === "event").map((entry) => entry.text),
  ).toEqual(["changed status to Blocked", "set priority to High"]);
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
  expect((await thread("t1"))?.status).toBe("closed");
  await transact("anshu", [update("t1", { status: "open" })]);
  expect((await thread("t1"))?.entries.at(-1)).toMatchObject({
    kind: "event",
    text: "reopened this",
  });
});

test("activity lines read in the actor's time zone", async () => {
  await transact("anshu", [createThread("t1")]);
  // 03:00 UTC on Tuesday is still Monday at UTC−7.
  await transact("anshu", [update("t1", { dueAtMs: Date.UTC(2026, 10, 3, 3) })], -420);
  expect((await thread("t1"))?.entries.at(-1)).toMatchObject({
    text: "set the due date to Mon, Nov 2",
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
  ["an unknown assignee", "anshu", [createThread("t2", { assigneeIds: ["nobody"] })], 404],
  ["changing who it's assigned to directly", "anshu", [update("t1", { assigneeId: "kk" })], 400],
  ["sending to someone unknown", "anshu", [sendTo("m9", "t1", ["nobody"])], 404],
  ["a duplicate thread id", "anshu", [createThread("t1")], 409],
  ["a misspelled field", "anshu", [update("t1", { statuss: "closed" })], 400],
  ["a bad status", "anshu", [update("t1", { status: "finished" })], 400],
  ["a removed field", "anshu", [update("t1", { schedule: null })], 400],
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
