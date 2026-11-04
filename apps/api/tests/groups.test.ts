import { decodeBootstrap } from "sync";
import {
  threadScore,
  labelSlug,
  ORGANIZATION_ID,
  SEEDED_LABELS,
  type Group,
  type Label,
  type ModelRecords,
  type Organization,
  type ThreadRecord,
  type TransactionInput,
} from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { memoryStorage } from "sync/server";
import { SyncEngine } from "../src/engine.ts";

const NOW = Date.UTC(2026, 10, 2, 8);

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({ now: () => NOW });
});

const transact = (actorId: string, transactions: TransactionInput[], workspace = "local") =>
  app.request("/sync/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Workspace": workspace },
    body: JSON.stringify({ actorId, transactions }),
  });

type Models = {
  Thread: ThreadRecord[];
  Label: Label[];
  Group: Group[];
  Organization: Organization[];
};

async function models(workspace = "local"): Promise<Models> {
  const response = await app.request("/sync/bootstrap", { headers: { "X-Workspace": workspace } });
  return (decodeBootstrap(await response.text()) as never as { models: Models }).models;
}

const groupOf = async (id: string): Promise<Group> => {
  const found = (await models()).Group.find((group) => group.id === id);
  if (found === undefined) throw new Error(`No group ${id}`);
  return found;
};

const labelOf = async (id: string): Promise<Label | undefined> =>
  (await models()).Label.find((label) => label.id === id);

const threadOf = async (id: string): Promise<ThreadRecord> => {
  const found = (await models()).Thread.find((thread) => thread.id === id);
  if (found === undefined) throw new Error(`No thread ${id}`);
  return found;
};

let counter = 0;
const txId = (): string => `groups-${++counter}`;

const createGroup = (id: string, name: string, memberIds: string[] = []): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Group",
  data: { id, name, memberIds },
});

const createLabel = (name: string): TransactionInput => ({
  id: txId(),
  type: "create",
  modelName: "Label",
  data: { id: labelSlug(name), name },
});

const updateGroup = (modelId: string, changes: object): TransactionInput =>
  ({ id: txId(), type: "update", modelName: "Group", modelId, changes }) as TransactionInput;

const updateThread = (modelId: string, changes: object): TransactionInput =>
  ({ id: txId(), type: "update", modelName: "Thread", modelId, changes }) as TransactionInput;

const createThread = (id: string, fields: object = {}): TransactionInput =>
  ({
    id: txId(),
    type: "create",
    modelName: "Thread",
    data: {
      id,
      title: "A thread",
      assigneeIds: ["arjun"],
      ...fields,
    },
  }) as TransactionInput;

// --- The organization ---

test("a new local workspace has one organization, unnamed, and the sample one is named", async () => {
  expect((await models()).Organization).toEqual([{ id: ORGANIZATION_ID, name: "" }]);
  expect((await models("sample")).Organization[0].name).not.toBe("");
});

test("anyone can name or rename the organization, but not to nothing", async () => {
  const rename = (name: string): TransactionInput =>
    ({
      id: txId(),
      type: "update",
      modelName: "Organization",
      modelId: ORGANIZATION_ID,
      changes: { name },
    }) as TransactionInput;
  expect((await transact("anshu", [rename("Acme")])).status).toBe(200);
  expect((await models()).Organization[0].name).toBe("Acme");
  await transact("arjun", [rename("Acme Labs")]);
  expect((await models()).Organization[0].name).toBe("Acme Labs");
  expect((await transact("arjun", [rename("  ")])).status).toBe(400);
});

// --- Labels ---

test("every workspace starts with the seeded labels", async () => {
  const labels = (await models()).Label;
  for (const seeded of SEEDED_LABELS)
    expect(labels.find((label) => label.id === seeded.id)?.name).toBe(seeded.name);
});

test("anyone can make a label, and thread labels must exist", async () => {
  expect((await transact("anshu", [createLabel("Frontend")])).status).toBe(200);
  expect(await labelOf("frontend")).toMatchObject({
    name: "Frontend",
    groupId: null,
    createdById: "anshu",
  });
  await transact("anshu", [createThread("t1")]);
  await transact("anshu", [updateThread("t1", { labelIds: ["frontend"] })]);
  expect((await threadOf("t1")).labelIds).toEqual(["frontend"]);
  expect((await transact("anshu", [updateThread("t1", { labelIds: ["nope"] })])).status).toBe(404);
  expect((await transact("anshu", [updateThread("t1", { labelIds: ["a", "a"] })])).status).toBe(
    400,
  );
});

test("making a label that exists does nothing, however it's written, and doesn't sink the thread with it", async () => {
  await transact("anshu", [createLabel("Back-end")]);
  const { Label: before } = await models();
  const made = await transact("arjun", [
    createLabel("BACK END"),
    createThread("t1", { labelIds: ["back-end"] }),
  ]);
  expect(made.status).toBe(200);
  expect((await models()).Label).toEqual(before);
  expect((await threadOf("t1")).labelIds).toEqual(["back-end"]);
});

test("a label's id must come from its name, and the name needs a letter or number", async () => {
  const wrong: TransactionInput = {
    id: txId(),
    type: "create",
    modelName: "Label",
    data: { id: "other", name: "Frontend" },
  };
  expect((await transact("anshu", [wrong])).status).toBe(400);
  expect((await transact("anshu", [createLabel("!!!")])).status).toBe(400);
});

test("a thread's label changes are logged, in words that fit a label or a group", async () => {
  await transact("anshu", [createGroup("g1", "Billing"), createLabel("Frontend")]);
  await transact("anshu", [createThread("t1")]);
  await transact("anshu", [updateThread("t1", { labelIds: ["frontend", "billing"] })]);
  await transact("anshu", [updateThread("t1", { labelIds: [] })]);
  const {
    models: { Entry },
  } = decodeBootstrap(
    await (await app.request("/sync/bootstrap", { headers: { "X-Workspace": "local" } })).text(),
  ) as never as { models: { Entry: { threadId: string; kind: string; text: string }[] } };
  expect(
    Entry.filter((entry) => entry.threadId === "t1" && entry.kind === "event").map((e) => e.text),
  ).toEqual([
    "labelled this Frontend",
    "added this to Billing",
    "removed the Frontend label",
    "removed this from Billing",
  ]);
});

test("labels work on threads, and must exist", async () => {
  await transact("anshu", [createThread("t1", { labelIds: ["bug"] })]);
  expect((await threadOf("t1")).labelIds).toEqual(["bug"]);
  expect((await transact("anshu", [updateThread("t1", { labelIds: ["nope"] })])).status).toBe(404);
});

// --- Groups ---

test("making a group makes its label, with the maker as a member, and tells who it added", async () => {
  await transact("anshu", [createGroup("g1", "Billing Migration", ["arjun"])]);
  const group = await groupOf("g1");
  expect(group).toMatchObject({
    name: "Billing Migration",
    labelId: "billing-migration",
    memberIds: ["anshu", "arjun"],
    createdById: "anshu",
    archived: false,
  });
  expect(group.activity.map((line) => [line.text, line.targetIds])).toEqual([
    ["created this group", []],
    ["added Arjun", ["arjun"]],
  ]);
  expect(await labelOf("billing-migration")).toMatchObject({ groupId: "g1" });
});

test("a group's name is unique, across groups and labels, however it's written", async () => {
  await transact("anshu", [createGroup("g1", "Billing")]);
  expect((await transact("arjun", [createGroup("g2", "BILLING")])).status).toBe(409);
  expect((await transact("arjun", [createGroup("g3", "Security")])).status).toBe(409);
  expect((await transact("arjun", [createGroup("g4", "...")])).status).toBe(400);
});

test("a group can't include someone who doesn't exist", async () => {
  expect((await transact("anshu", [createGroup("g1", "Billing", ["nobody"])])).status).toBe(404);
});

test("a thread is in a group by having its label, and can be in two", async () => {
  await transact("anshu", [createGroup("g1", "Billing"), createGroup("g2", "Launch Week")]);
  await transact("anshu", [createThread("t1", { labelIds: ["billing", "launch-week"] })]);
  expect((await threadOf("t1")).labelIds).toEqual(["billing", "launch-week"]);
});

test("any member can change a group, and each change is logged", async () => {
  await transact("anshu", [createGroup("g1", "Billing", ["arjun"])]);
  await transact("arjun", [updateGroup("g1", { memberIds: ["anshu", "arjun", "kk"] })]);
  await transact("anshu", [updateGroup("g1", { name: "Billing V2" })]);
  await transact("arjun", [updateGroup("g1", { memberIds: ["anshu", "arjun"] })]);
  await transact("arjun", [updateGroup("g1", { archived: true })]);
  const group = await groupOf("g1");
  expect(group.name).toBe("Billing V2");
  expect(group.archived).toBe(true);
  expect(group.activity.slice(2).map((line) => line.text)).toEqual([
    "added KK",
    "renamed this to “Billing V2”",
    "removed KK",
    "archived this",
  ]);
});

test("renaming a group renames its label, keeping threads in it, and the new name must be free", async () => {
  await transact("anshu", [createGroup("g1", "Billing"), createGroup("g2", "Other")]);
  await transact("anshu", [createThread("t1", { labelIds: ["billing"] })]);
  await transact("anshu", [updateGroup("g1", { name: "Payments" })]);
  expect((await labelOf("billing"))?.name).toBe("Payments");
  expect((await threadOf("t1")).labelIds).toEqual(["billing"]);
  expect((await transact("anshu", [updateGroup("g1", { name: "OTHER" })])).status).toBe(409);
  // Just recapitalizing its own name is fine.
  expect((await transact("anshu", [updateGroup("g1", { name: "PAYMENTS" })])).status).toBe(200);
});

test("a non-member can join a group, but can't change anything else", async () => {
  await transact("anshu", [createGroup("g1", "Billing")]);
  expect((await transact("kk", [updateGroup("g1", { name: "Mine" })])).status).toBe(403);
  expect(
    (await transact("kk", [updateGroup("g1", { memberIds: ["anshu", "arjun"] })])).status,
  ).toBe(403);
  expect((await transact("kk", [updateGroup("g1", { memberIds: ["anshu", "kk"] })])).status).toBe(
    200,
  );
  expect((await groupOf("g1")).activity.at(-1)?.text).toBe("joined");
});

test("members can leave, but a group can't be left empty", async () => {
  await transact("anshu", [createGroup("g1", "Billing", ["arjun"])]);
  await transact("arjun", [updateGroup("g1", { memberIds: ["anshu"] })]);
  expect((await groupOf("g1")).activity.at(-1)?.text).toBe("left");
  expect((await transact("anshu", [updateGroup("g1", { memberIds: [] })])).status).toBe(400);
  expect(
    (await transact("anshu", [updateGroup("g1", { memberIds: ["anshu", "anshu"] })])).status,
  ).toBe(400);
});

test("a blocker or branch stays in its parent's groups, but not its other labels", async () => {
  await transact("anshu", [createGroup("g1", "Billing"), createLabel("Frontend")]);
  await transact("anshu", [createThread("t1", { labelIds: ["billing", "frontend"] })]);
  await transact("anshu", [createThread("b1", { branchedFromId: "t1" })]);
  await transact("anshu", [createThread("b2", { blocksId: "t1" })]);
  expect((await threadOf("b1")).labelIds).toEqual(["billing"]);
  expect((await threadOf("b2")).labelIds).toEqual(["billing"]);
});

test("only seeded labels affect the score: a made-up one can't jump the queue", async () => {
  await transact("anshu", [createThread("plain"), createThread("bug"), createThread("made-up")]);
  await transact("anshu", [createLabel("Very Important")]);
  await transact("anshu", [
    updateThread("bug", { labelIds: ["bug"] }),
    updateThread("made-up", { labelIds: ["very-important"] }),
  ]);
  const score = async (id: string): Promise<number> => threadScore(await threadOf(id), 0, NOW);
  expect(await score("made-up")).toBe(await score("plain"));
  expect(await score("bug")).toBeGreaterThan(await score("plain"));
});

test("the sample workspace has a group with threads in it", async () => {
  const { Group: groups, Thread: threads } = await models("sample");
  expect(groups.map((group) => group.name)).toEqual(["Q4 Planning"]);
  expect(
    threads.filter((thread) => thread.labelIds.includes("q4-planning")).length,
  ).toBeGreaterThan(0);
});

test("records stored by older versions load in today's shape", () => {
  const {
    labelIds: _labels,
    triage: _triage,
    ...rest
  } = {
    id: "t1",
    title: "Old",
    createdById: "anshu",
    assigneeIds: ["arjun"],
    status: "open",
    priority: "none",
    dueAtMs: null,
    effortHours: null,
    labelIds: [],
    triage: {},
    doneBy: {},
    snoozedUntil: {},
    branchedFromId: null,
    blocksId: null,
    seenBy: {},
    createdAtMs: NOW,
    updatedAtMs: NOW,
  } satisfies ThreadRecord;
  // Labels were tags, threads had schedules and kinds, meetings had call links, messages weren't sent to anyone, a
  // bucket was one person's, and a thread had a requester and one assignee.
  const { assigneeIds: _assignees, ...unassigned } = rest;
  const old = {
    schedule: null,
    blocks: [],
    workedMinutes: 0,
    requesterId: "anshu",
    assigneeId: "arjun",
  };
  const engine = new SyncEngine({
    now: () => NOW,
    storage: memoryStorage<ModelRecords>({
      lastSyncId: 1,
      models: [
        {
          modelName: "Thread",
          data: {
            ...unassigned,
            ...old,
            kind: "response",
            tagIds: ["bug"],
            attendeeIds: [],
            triage: {
              personId: "arjun",
              bucketId: "action",
              reason: "",
              manual: false,
              stale: false,
            },
          } as never,
        },
        {
          modelName: "Thread",
          data: {
            ...unassigned,
            ...old,
            assigneeId: null,
            id: "m1",
            kind: "meeting",
            attendeeIds: ["anshu", "kk"],
            triage: null,
          } as never,
        },
        {
          modelName: "Entry",
          data: {
            id: "m1:call",
            threadId: "m1",
            kind: "call",
            link: "zoom",
            createdAtMs: NOW,
          } as never,
        },
        {
          modelName: "Entry",
          data: {
            id: "e1",
            threadId: "t1",
            kind: "message",
            authorId: "anshu",
            text: "Hi",
            createdAtMs: NOW,
          } as never,
        },
      ],
    }),
  });
  const stored = engine.models.Thread.get("t1");
  expect(stored).toMatchObject({
    createdById: "anshu",
    assigneeIds: ["arjun"],
    labelIds: ["bug"],
    triage: { arjun: { bucketId: "action", reason: "", manual: false, stale: false } },
    doneBy: {},
    snoozedUntil: {},
  });
  for (const gone of [
    "tagIds",
    "schedule",
    "blocks",
    "workedMinutes",
    "kind",
    "attendeeIds",
    "requesterId",
    "assigneeId",
  ])
    expect(stored).not.toHaveProperty(gone);
  expect(engine.models.Thread.get("m1")).toMatchObject({ triage: {}, assigneeIds: [] });
  expect([...engine.models.Entry.values()]).toEqual([
    {
      id: "e1",
      threadId: "t1",
      kind: "message",
      authorId: "anshu",
      text: "Hi",
      createdAtMs: NOW,
      sentToIds: [],
    },
  ]);
});

test("restoring puts back what a wipe keeps", () => {
  const engine = new SyncEngine({ now: () => NOW });
  engine.restore([{ modelName: "Organization", data: { id: ORGANIZATION_ID, name: "Acme" } }]);
  expect(engine.models.Organization.get(ORGANIZATION_ID)?.name).toBe("Acme");
});

test("a group's members are set whole, and the later change wins", async () => {
  await transact("anshu", [createGroup("g1", "Payments", ["arjun"])]);
  await transact("anshu", [updateGroup("g1", { memberIds: ["anshu", "arjun", "kk"] })]);
  await transact("arjun", [updateGroup("g1", { memberIds: ["arjun"] })]);
  expect((await groupOf("g1")).memberIds).toEqual(["arjun"]);
  expect((await transact("arjun", [updateGroup("g1", { memberIds: [] })])).status).toBe(400);
});
