import {
  toThreads,
  type Person,
  type Thread,
  type ThreadRecord,
  type TransactionInput,
} from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";

// A fixed clock: Monday 2026-11-02, midnight in the organization's time zone (UTC−8).
const NOW = Date.UTC(2026, 10, 2, 8);

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({ now: () => NOW });
});

const transact = (actorId: string, transactions: TransactionInput[]) =>
  app.request("/sync/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Workspace": "local" },
    body: JSON.stringify({ actorId, transactions }),
  });

type Models = { models: { Person: Person[]; Thread: ThreadRecord[]; Entry: never[] } };

async function thread(id: string): Promise<Thread> {
  const response = await app.request("/sync/bootstrap", { headers: { "X-Workspace": "local" } });
  const { models } = (await response.json()) as Models;
  const found = toThreads(
    models.Thread,
    models.Entry,
    new Map(models.Person.map((person) => [person.id, person])),
  ).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No thread ${id}`);
  return found;
}

const activity = (subject: Thread): string[] =>
  subject.entries.flatMap((entry) => (entry.kind === "event" ? [entry.text] : []));

let counter = 0;
const txId = (): string => `on-behalf-${++counter}`;

const create = (id: string, fields: object = {}): TransactionInput =>
  ({
    id: txId(),
    type: "create",
    modelName: "Thread",
    data: {
      id,
      title: "Set up the on-call rotation",
      assigneeId: "arjun",
      ...fields,
    },
  }) as TransactionInput;

const update = (modelId: string, changes: object): TransactionInput =>
  ({ id: txId(), type: "update", modelName: "Thread", modelId, changes }) as TransactionInput;

const description = (threadId: string): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Entry",
  data: { id: threadId, threadId, kind: "message", text: "Details" },
});

test("making a thread on someone's behalf makes them the requester and records who made it", async () => {
  await transact("anshu", [create("t1", { onBehalfOfId: "kk" })]);
  const found = await thread("t1");
  expect(found.requester.id).toBe("kk");
  expect(found.createdBy.id).toBe("anshu");
  expect(found.assignee?.id).toBe("arjun");
  expect(
    found.entries.flatMap((entry) => (entry.kind === "event" ? [entry.actor.id] : [])),
  ).toEqual(["anshu"]);
  expect(activity(found)).toEqual(["created this on behalf of KK"]);
});

test("a thread made for yourself has you as both, and no activity line", async () => {
  for (const [id, fields] of [
    ["t1", {}],
    ["t2", { onBehalfOfId: null }],
    ["t3", { onBehalfOfId: "anshu" }],
  ] as const)
    await transact("anshu", [create(id, fields)]);
  for (const id of ["t1", "t2", "t3"]) {
    const found = await thread(id);
    expect(found.requester.id).toBe("anshu");
    expect(found.createdBy.id).toBe("anshu");
    expect(activity(found)).toEqual([]);
  }
});

test("whoever made the thread writes its description, even when someone else is the requester", async () => {
  const made = await transact("anshu", [create("t1", { onBehalfOfId: "kk" }), description("t1")]);
  expect(made.status).toBe(200);
  await transact("anshu", [create("t2", { onBehalfOfId: "kk" })]);
  expect((await transact("kk", [description("t2")])).status).toBe(403);
});

test("on behalf of needs a real person", async () => {
  const nobody = await transact("anshu", [create("t1", { onBehalfOfId: "nobody" })]);
  expect(nobody.status).toBe(404);
});

test("the requester can change later, with an activity line, keeping who made it", async () => {
  await transact("anshu", [create("t1")]);
  await transact("arjun", [update("t1", { requesterId: "kk" })]);
  const found = await thread("t1");
  expect(found.requester.id).toBe("kk");
  expect(found.createdBy.id).toBe("anshu");
  expect(activity(found)).toEqual(["made KK the requester"]);
  // Setting the same person again changes nothing.
  await transact("arjun", [update("t1", { requesterId: "kk" })]);
  expect(activity(await thread("t1"))).toEqual(["made KK the requester"]);
});

test("changing the requester needs a real person", async () => {
  await transact("anshu", [create("t1")]);
  expect((await transact("anshu", [update("t1", { requesterId: "nobody" })])).status).toBe(404);
});
