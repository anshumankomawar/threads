import { SCHEMA_HASH } from "model";
import { decodeBootstrap } from "sync";
import type { Group, Sprint, SprintChanges, ThreadRecord, TransactionInput } from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";

const NOW = Date.UTC(2026, 10, 2, 8);
const DAY = 24 * 60 * 60_000;

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({ now: () => NOW });
});

const transact = (actorId: string, transactions: TransactionInput[]) =>
  app.request("/sync/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Workspace": "local" },
    body: JSON.stringify({ actorId, schemaHash: SCHEMA_HASH, transactions }),
  });

type Models = { Thread: ThreadRecord[]; Group: Group[]; Sprint: Sprint[] };

async function models(): Promise<Models> {
  const response = await app.request("/sync/bootstrap", { headers: { "X-Workspace": "local" } });
  return (decodeBootstrap(await response.text()) as never as { models: Models }).models;
}

const sprintOf = async (id: string): Promise<Sprint | undefined> =>
  (await models()).Sprint.find((sprint) => sprint.id === id);

let counter = 0;
const txId = (): string => `sprints-${++counter}`;

const createGroup = (id: string, name: string, memberIds: string[] = []): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Group",
  data: { id, name, memberIds },
});

const createThread = (id: string, labelIds: string[] = []): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Thread",
  data: { id, title: id, labelIds },
});

const createSprint = (
  id: string,
  groupId: string,
  threadIds: string[] = [],
  days = 14,
): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Sprint",
  data: { id, groupId, name: `Sprint ${id}`, startMs: NOW, endMs: NOW + days * DAY, threadIds },
});

const updateSprint = (id: string, changes: SprintChanges): TransactionInput => ({
  id: txId(),
  type: "update",
  modelName: "Sprint",
  modelId: id,
  changes,
});

// Arjun and Anshu's Platform group, with one thread in it and one outside it.
async function setUp(): Promise<void> {
  const response = await transact("arjun", [
    createGroup("g-platform", "Platform", ["anshu"]),
    createThread("in-group", ["platform"]),
    createThread("outside"),
  ]);
  expect(response.status).toBe(200);
}

test("a group's members start a sprint with the group's threads, noted in its activity", async () => {
  await setUp();
  expect((await transact("anshu", [createSprint("s1", "g-platform", ["in-group"])])).status).toBe(
    200,
  );
  const sprint = await sprintOf("s1");
  expect(sprint?.threadIds).toEqual(["in-group"]);
  expect(sprint?.closed).toBe(false);
  const group = (await models()).Group.find((item) => item.id === "g-platform");
  expect(group?.activity.at(-1)?.text).toBe("started Sprint s1");
});

test("a sprint needs a real, live group, and only its members can plan it", async () => {
  await setUp();
  expect((await transact("arjun", [createSprint("s1", "nowhere")])).status).toBe(404);
  expect((await transact("kk", [createSprint("s1", "g-platform")])).status).toBe(403);
  await transact("arjun", [
    {
      id: txId(),
      type: "update",
      modelName: "Group",
      modelId: "g-platform",
      changes: { archived: true },
    },
  ]);
  expect((await transact("arjun", [createSprint("s1", "g-platform")])).status).toBe(400);
  expect(await sprintOf("s1")).toBeUndefined();
});

test("only threads with the group's label go in its sprints", async () => {
  await setUp();
  expect((await transact("arjun", [createSprint("s1", "g-platform", ["outside"])])).status).toBe(
    400,
  );
  await transact("arjun", [createSprint("s1", "g-platform")]);
  expect((await transact("arjun", [updateSprint("s1", { threadIds: ["outside"] })])).status).toBe(
    400,
  );
  expect((await transact("arjun", [updateSprint("s1", { threadIds: ["missing"] })])).status).toBe(
    404,
  );
  expect((await sprintOf("s1"))?.threadIds).toEqual([]);
});

test("a thread made in the group can go in a sprint in the same batch", async () => {
  await setUp();
  await transact("arjun", [createSprint("s1", "g-platform")]);
  const response = await transact("arjun", [
    createThread("new-one", ["platform"]),
    updateSprint("s1", { threadIds: ["new-one"] }),
  ]);
  expect(response.status).toBe(200);
  expect((await sprintOf("s1"))?.threadIds).toEqual(["new-one"]);
});

test("a thread is in one open sprint of a group at a time, and closed sprints don't count", async () => {
  await setUp();
  await transact("arjun", [createSprint("s1", "g-platform", ["in-group"])]);
  expect((await transact("arjun", [createSprint("s2", "g-platform", ["in-group"])])).status).toBe(
    409,
  );
  await transact("arjun", [updateSprint("s1", { closed: true })]);
  expect((await transact("arjun", [createSprint("s2", "g-platform", ["in-group"])])).status).toBe(
    200,
  );
  // Reopening the first would put the thread in two open sprints.
  expect((await transact("arjun", [updateSprint("s1", { closed: false })])).status).toBe(409);
});

test("a sprint runs from a day to a year", async () => {
  await setUp();
  expect((await transact("arjun", [createSprint("s1", "g-platform", [], 0)])).status).toBe(400);
  expect((await transact("arjun", [createSprint("s1", "g-platform", [], 400)])).status).toBe(400);
  expect((await transact("arjun", [createSprint("s1", "g-platform", [], 1)])).status).toBe(200);
});

test("taking a thread out of the group takes it out of the group's open sprints, not closed ones", async () => {
  await setUp();
  await transact("arjun", [
    createThread("second", ["platform"]),
    createSprint("old", "g-platform", ["second"]),
  ]);
  await transact("arjun", [updateSprint("old", { closed: true })]);
  await transact("arjun", [createSprint("s1", "g-platform", ["in-group", "second"])]);
  await transact("arjun", [
    {
      id: txId(),
      type: "update",
      modelName: "Thread",
      modelId: "second",
      changes: { labelIds: [] },
    },
  ]);
  expect((await sprintOf("s1"))?.threadIds).toEqual(["in-group"]);
  expect((await sprintOf("old"))?.threadIds).toEqual(["second"]);
});

test("sprints never change the threads in them", async () => {
  await setUp();
  const before = (await models()).Thread.find((thread) => thread.id === "in-group");
  await transact("arjun", [createSprint("s1", "g-platform", ["in-group"])]);
  await transact("arjun", [updateSprint("s1", { closed: true, name: "Done" })]);
  const after = (await models()).Thread.find((thread) => thread.id === "in-group");
  expect(after).toEqual(before);
});
