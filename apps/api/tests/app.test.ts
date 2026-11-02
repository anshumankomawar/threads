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
    branchedFromId: string;
  }> = {},
): TransactionInput =>
  ({
    id: txId(),
    type: "create",
    modelName: "Thread",
    data: {
      id,
      kind: "issue",
      title: "Plan the offsite",
      assigneeId: "arjun",
      attendeeIds: [],
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
    kind: "issue",
    title: "Plan the offsite",
    requester: { id: "anshu" },
    assignee: { id: "arjun" },
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

// --- Conversations ---

const conversation = (id: string, parentId: string, attendeeIds: string[]): TransactionInput =>
  createThread(id, {
    kind: "conversation",
    title: "Which endpoint?",
    assigneeId: null,
    attendeeIds,
    branchedFromId: parentId,
  });

test("a conversation is with the people mentioned, and the thread it's in links to it", async () => {
  await transact("anshu", [createThread("t1")]);
  await transact("anshu", [conversation("c1", "t1", ["arjun"]), message("m1", "c1", "Which one?")]);
  expect(await thread("c1")).toMatchObject({
    kind: "conversation",
    requester: { id: "anshu" },
    assignee: null,
    attendees: [{ id: "anshu" }, { id: "arjun" }],
    branchedFromId: "t1",
  });
  expect((await thread("t1"))?.entries.at(-1)).toMatchObject({
    kind: "message",
    author: { id: "anshu" },
    text: "Started a conversation [[thread:c1]]",
  });
  // Only in an open thread that isn't itself a conversation, with someone else, and with no assignee or time.
  expect((await transact("anshu", [conversation("c2", "c1", ["kk"])])).status).toBe(400);
  expect((await transact("anshu", [conversation("c3", "t1", ["anshu"])])).status).toBe(400);
  expect((await transact("anshu", [conversation("c4", "missing", ["kk"])])).status).toBe(404);
  const assigned = createThread("c5", {
    kind: "conversation",
    assigneeId: "kk",
    attendeeIds: ["kk"],
    branchedFromId: "t1",
  });
  expect((await transact("anshu", [assigned])).status).toBe(400);
});

test("mentioning someone in a conversation brings them in", async () => {
  await transact("anshu", [createThread("t1"), conversation("c1", "t1", ["arjun"])]);
  await transact("arjun", [message("m1", "c1", "Ask [[person:kk]] too")]);
  const talk = await thread("c1");
  expect(talk?.attendees.map((person) => person.id)).toEqual(["anshu", "arjun", "kk"]);
  expect(talk?.entries.at(-1)).toMatchObject({ kind: "event", text: "added KK" });
});

test("closing or resolving a thread closes the conversations in it", async () => {
  await transact("anshu", [
    createThread("t1"),
    conversation("c1", "t1", ["arjun"]),
    conversation("c2", "t1", ["kk"]),
  ]);
  await transact("arjun", [update("c2", { status: "closed" })]);
  await transact("anshu", [update("t1", { status: "closed" })]);
  expect((await thread("c1"))?.status).toBe("closed");
  expect((await thread("c1"))?.entries.at(-1)).toMatchObject({ text: "closed with [[thread:t1]]" });
  // One already closed by hand says nothing more.
  expect((await thread("c2"))?.entries.at(-1)).toMatchObject({ text: "changed status to Closed" });

  await transact("anshu", [createThread("t2"), conversation("c3", "t2", ["arjun"])]);
  await transact("arjun", [
    {
      id: txId(),
      type: "create",
      modelName: "Entry",
      data: { id: "r1", threadId: "t2", kind: "resolution", text: "Done" },
    },
  ]);
  expect((await thread("c3"))?.status).toBe("closed");
});

test("updates record an activity line for each real change, in the actor's words", async () => {
  await transact("anshu", [createThread("t1"), message("m1", "t1")]);
  clock = NOW + 1000;
  await transact("arjun", [update("t1", { status: "blocked", priority: "high" })]);
  await transact("arjun", [update("t1", { status: "blocked" })]);
  await transact("arjun", [update("t1", { assigneeId: "arjun" })]);
  await transact("arjun", [update("t1", { assigneeId: "kk" })]);
  const result = await thread("t1");
  expect(result).toMatchObject({
    status: "blocked",
    priority: "high",
    updatedAtMs: NOW + 1000,
  });
  expect(
    result?.entries.filter((entry) => entry.kind === "event").map((entry) => entry.text),
  ).toEqual(["changed status to Blocked", "set priority to High", "assigned this to KK"]);
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
  ["an unknown assignee", "anshu", [createThread("t2", { assigneeId: "nobody" })], 404],
  [
    "an unknown person in a conversation",
    "anshu",
    [
      createThread("t2", {
        kind: "conversation",
        assigneeId: null,
        attendeeIds: ["nobody"],
        branchedFromId: "t1",
      }),
    ],
    404,
  ],
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
