import {
  toThreads,
  waitingOn,
  type Person,
  type Schedule,
  type SyncAction,
  type Thread,
  type ThreadRecord,
  type TransactionInput,
} from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { SyncEngine } from "../src/engine.ts";

// A fixed clock: Monday 2026-11-02, midnight in the organization's time zone (UTC−8).
const NOW = Date.UTC(2026, 10, 2, 8);
const NINE = NOW + 9 * 60 * 60_000;
const HALF_HOUR = 30 * 60_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const slotAt = (startMs: number, minutes = 30): Schedule => ({
  startMs,
  endMs: startMs + minutes * 60_000,
});

let app: ReturnType<typeof createApp>;
let clock: number;

beforeEach(() => {
  clock = NOW;
  app = createApp({ now: () => clock });
});

function send(method: string, path: string, body?: unknown, workspace = "local") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Workspace": workspace },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const transact = (actorId: string, transactions: TransactionInput[]) =>
  send("POST", "/sync/transactions", { actorId, transactions });

type Models = {
  lastSyncId: number;
  models: { Person: Person[]; Thread: ThreadRecord[]; Entry: never[] };
};

const bootstrap = async (workspace = "local"): Promise<Models> =>
  (await send("GET", "/sync/bootstrap", undefined, workspace)).json() as Promise<Models>;

async function threads(workspace = "local"): Promise<Thread[]> {
  const { models } = await bootstrap(workspace);
  return toThreads(
    models.Thread,
    models.Entry,
    new Map(models.Person.map((person) => [person.id, person])),
  );
}

async function thread(id: string): Promise<Thread> {
  const found = (await threads()).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No thread ${id}`);
  return found;
}

const activity = (subject: Thread): string[] =>
  subject.entries.flatMap((entry) => (entry.kind === "event" ? [entry.text] : []));

let counter = 0;
const txId = (): string => `scheduling-${++counter}`;

const message = (id: string, threadId: string, text = "Text"): TransactionInput => ({
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

// A thread asking Arjun for something unless said otherwise, made and opened in one batch.
const ask = (id: string, fields: object = {}): TransactionInput[] => [
  {
    id: txId(),
    type: "create",
    modelName: "Thread",
    data: {
      id,
      kind: "response",
      title: "Ask",
      assigneeId: "arjun",
      attendeeIds: [],
      schedule: null,
      ...fields,
    },
  } as TransactionInput,
  message(`${id}-m`, id),
];

test("a new response takes the first free working slot of whoever it's waiting on", async () => {
  await transact("anshu", ask("t1"));
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE));
  await transact("anshu", ask("t2"));
  expect((await thread("t2")).schedule).toEqual(slotAt(NINE + HALF_HOUR));
});

test("nobody sets a response's slot by hand", async () => {
  await transact("anshu", ask("t1"));
  const manual = await transact("anshu", [update("t1", { schedule: slotAt(NINE + HALF_HOUR) })]);
  expect(manual.status).toBe(400);
});

test("people each have their own schedule", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", ask("t2", { assigneeId: "anshu" }));
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE));
  expect((await thread("t2")).schedule).toEqual(slotAt(NINE));
});

test("raising a priority moves a thread ahead of the ones it now outscores", async () => {
  await transact("anshu", ask("t1"));
  await transact("anshu", ask("t2"));
  await transact("anshu", ask("t3"));
  await transact("anshu", [update("t3", { priority: "urgent" })]);
  expect((await thread("t3")).schedule?.startMs).toBe(NINE);
  expect((await thread("t1")).schedule?.startMs).toBe(NINE + HALF_HOUR);
  expect((await thread("t2")).schedule?.startMs).toBe(NINE + 2 * HALF_HOUR);
});

test("a tag change moves a thread only once it beats the one ahead by the margin", async () => {
  await transact("anshu", ask("t1"));
  await transact("anshu", ask("t2"));
  // The top tag alone adds 9.9 points, just short of the margin.
  await transact("anshu", [update("t2", { tagIds: ["incident"] })]);
  expect((await thread("t2")).schedule?.startMs).toBe(NINE + HALF_HOUR);
  await transact("anshu", [update("t2", { priority: "high" })]);
  expect((await thread("t2")).schedule?.startMs).toBe(NINE);
});

test("effort sets how much time a thread gets, and shows in the activity", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", [update("t1", { effortHours: 1 })]);
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE, 60));
  await transact("arjun", [update("t1", { effortHours: 8 })]);
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE, 480));
  await transact("arjun", [update("t1", { effortHours: null })]);
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE));
  expect(activity(await thread("t1"))).toEqual([
    "estimated this at 1h",
    "estimated this at 8h",
    "removed the estimate",
  ]);
});

test("tags are saved and show in the activity", async () => {
  await transact("anshu", ask("t1"));
  await transact("anshu", [update("t1", { tagIds: ["security", "bug"] })]);
  await transact("anshu", [update("t1", { tagIds: ["bug"] })]);
  const found = await thread("t1");
  expect(found.tagIds).toEqual(["bug"]);
  expect(activity(found)).toEqual([
    "tagged this Security",
    "tagged this Bug",
    "removed the Security tag",
  ]);
});

test.each<[string, object]>([
  ["an effort below 30 minutes", { effortHours: 0.25 }],
  ["an effort that isn't in half hours", { effortHours: 1.2 }],
  ["an unknown tag", { tagIds: ["nope"] }],
  ["a repeated tag", { tagIds: ["bug", "bug"] }],
])("an update with %s is refused", async (_, changes) => {
  await transact("anshu", ask("t1"));
  expect((await transact("anshu", [update("t1", changes)])).status).toBe(400);
});

test("a meeting takes its time back from the responses on each attendee's schedule", async () => {
  await transact("anshu", ask("t1"));
  await transact("anshu", [
    {
      id: txId(),
      type: "create",
      modelName: "Thread",
      data: {
        id: "meet",
        kind: "meeting",
        title: "Meet",
        assigneeId: null,
        attendeeIds: ["arjun"],
        schedule: slotAt(NINE, 60),
      },
    },
  ]);
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE + 2 * HALF_HOUR));
  expect((await thread("meet")).schedule).toEqual(slotAt(NINE, 60));
});

test("messages never move a thread: it stays on the assignee's schedule until it's closed", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", [message("m2", "t1", "Halfway there")]);
  await transact("anshu", [message("m3", "t1", "Any update?")]);
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE));
});

test("a blocked thread gives up its slot until it's unblocked", async () => {
  await transact("anshu", ask("t1"));
  await transact("anshu", ask("t2"));
  await transact("arjun", [update("t1", { status: "blocked" })]);
  expect((await thread("t1")).schedule).toBeNull();
  expect((await thread("t2")).schedule?.startMs).toBe(NINE);
  await transact("arjun", [update("t1", { status: "open" })]);
  expect((await thread("t1")).schedule?.startMs).toBe(NINE + HALF_HOUR);
});

test("closing a thread leaves a gap until the next change on that schedule", async () => {
  await transact("anshu", ask("t1"));
  await transact("anshu", ask("t2"));
  await transact("arjun", [update("t1", { status: "closed" })]);
  expect((await thread("t2")).schedule?.startMs).toBe(NINE + HALF_HOUR);
  await transact("anshu", ask("t3"));
  expect((await thread("t2")).schedule?.startMs).toBe(NINE);
  expect((await thread("t3")).schedule?.startMs).toBe(NINE + HALF_HOUR);
});

test("a resent batch doesn't reschedule anything", async () => {
  const batch = ask("t1");
  await transact("anshu", batch);
  const { lastSyncId } = await bootstrap();
  await transact("anshu", batch);
  expect((await bootstrap()).lastSyncId).toBe(lastSyncId);
});

test("a change that leaves the schedule alone adds no slot moves to the sync log", async () => {
  await transact("anshu", ask("t1"));
  const { lastSyncId } = await bootstrap();
  await transact("arjun", [update("t1", { title: "Renamed" })]);
  const { actions } = (await (await send("GET", `/sync/deltas?after=${lastSyncId}`)).json()) as {
    actions: SyncAction[];
  };
  // The rename and its activity line.
  expect(actions).toHaveLength(2);
});

const oldThread: ThreadRecord = {
  id: "t1",
  kind: "response",
  title: "Old ask",
  requesterId: "arjun",
  assigneeId: "anshu",
  attendeeIds: [],
  status: "open",
  priority: "none",
  dueAtMs: null,
  effortHours: null,
  tagIds: [],
  schedule: null,
  blocks: [],
  replyBlocks: [],
  workedMinutes: 0,
  branchedFromId: null,
  blocksId: null,
  createdAtMs: NOW,
  updatedAtMs: NOW,
};

function loaded(records: ThreadRecord[]): SyncEngine {
  const engine = new SyncEngine({ now: () => NOW });
  engine.load(
    [
      { modelName: "Person", data: { id: "anshu", name: "Anshu" } },
      { modelName: "Person", data: { id: "arjun", name: "Arjun" } },
      ...records.map((data) => ({ modelName: "Thread" as const, data })),
    ],
    4,
  );
  return engine;
}

test("looking over schedules places threads without a slot and skips closed ones", () => {
  const engine = loaded([oldThread, { ...oldThread, id: "t2", status: "closed" }]);
  engine.replanAll();
  expect(engine.models.Thread.get("t1")?.schedule).toEqual(slotAt(NINE));
  expect(engine.models.Thread.get("t2")?.schedule).toBeNull();
});

test("looking over schedules moves slots that passed, on threads stored before effort and tags", () => {
  const { effortHours: _effort, tagIds: _tags, ...stored } = oldThread;
  const engine = loaded([{ ...stored, schedule: slotAt(NOW - 24 * 60 * 60_000) } as ThreadRecord]);
  engine.replanAll();
  expect(engine.models.Thread.get("t1")?.schedule).toEqual(slotAt(NINE));
});

test("looking over a settled schedule again writes nothing", () => {
  const engine = loaded([oldThread]);
  engine.replanAll();
  const { lastSyncId } = engine;
  engine.replanAll();
  expect(engine.lastSyncId).toBe(lastSyncId);
});

test("the sample schedules sit in working hours, on weekdays, with no overlaps", async () => {
  const all = await threads("sample");
  const people = new Set(all.flatMap((subject) => waitingOn(subject) ?? []));
  expect(people.size).toBeGreaterThan(0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  });

  for (const person of people) {
    const slots = all
      .filter(
        (subject) =>
          subject.kind === "response" &&
          subject.status === "open" &&
          waitingOn(subject) === person &&
          subject.blocks.length > 0,
      )
      .flatMap((subject) => subject.blocks)
      .sort((a, b) => a.startMs - b.startMs);
    slots.forEach((slot, index) => {
      const parts = Object.fromEntries(
        formatter.formatToParts(slot.startMs).map(({ type, value }) => [type, value]),
      );
      expect(["Sat", "Sun"]).not.toContain(parts.weekday);
      expect(Number(parts.hour)).toBeGreaterThanOrEqual(9);
      expect(Number(parts.hour)).toBeLessThan(17);
      if (index > 0) expect(slot.startMs).toBeGreaterThanOrEqual(slots[index - 1].endMs);
    });
  }
});

test("a long thread runs as one block across the free time, and splits around a meeting", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", [update("t1", { effortHours: 8 })]);
  expect((await thread("t1")).blocks).toEqual([slotAt(NINE, 480)]);
  await transact("anshu", [
    {
      id: txId(),
      type: "create",
      modelName: "Thread",
      data: {
        id: "meet",
        kind: "meeting",
        title: "Meet",
        assigneeId: null,
        attendeeIds: ["arjun"],
        schedule: slotAt(NINE + 2 * HOUR, 60),
      },
    },
  ]);
  const { blocks, schedule } = await thread("t1");
  expect(blocks).toEqual([slotAt(NINE, 120), slotAt(NINE + 3 * HOUR, 300), slotAt(NINE + DAY, 60)]);
  expect(schedule).toEqual(blocks[0]);
});

test("effort has no upper limit; it just spans more days", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", [update("t1", { effortHours: 16 })]);
  expect((await thread("t1")).blocks).toEqual([slotAt(NINE, 480), slotAt(NINE + DAY, 480)]);
  expect(activity(await thread("t1"))).toEqual(["estimated this at 16h"]);
});

test("an estimate is the assignee's work: while nobody's assigned, whoever asked gets the shortest block", async () => {
  await transact("anshu", ask("t1", { assigneeId: null }));
  await transact("anshu", [update("t1", { effortHours: 8 })]);
  expect((await thread("t1")).blocks).toEqual([slotAt(NINE)]);
  await transact("anshu", [update("t1", { assigneeId: "arjun" })]);
  expect((await thread("t1")).blocks).toEqual([slotAt(NINE, 480)]);
});

test("blocks that ended count as work done, and stay on the thread", () => {
  const past = slotAt(NOW - 24 * HOUR, 60);
  const engine = loaded([{ ...oldThread, effortHours: 4, blocks: [past], schedule: past }]);
  engine.replanAll();
  const stored = engine.models.Thread.get("t1");
  expect(stored?.blocks).toEqual([past, slotAt(NINE, 180)]);
  expect(stored?.schedule).toEqual(slotAt(NINE, 180));
});

test("a thread still open after its estimate is used up gets another short block", () => {
  const past = slotAt(NOW - 24 * HOUR, 60);
  const engine = loaded([{ ...oldThread, effortHours: 1, blocks: [past], schedule: past }]);
  engine.replanAll();
  expect(engine.models.Thread.get("t1")?.blocks).toEqual([past, slotAt(NINE)]);
});

test("a blocked thread gives up what's left of its blocks but keeps those that ended", () => {
  const past = slotAt(NOW - 24 * HOUR, 60);
  const engine = loaded([
    { ...oldThread, status: "blocked", blocks: [past, slotAt(NINE)], schedule: slotAt(NINE) },
  ]);
  engine.replanAll();
  const stored = engine.models.Thread.get("t1");
  expect(stored?.blocks).toEqual([past]);
  expect(stored?.schedule).toBeNull();
});

test("/blocked: a blocker blocks its thread off the schedule, and closing it unblocks and reschedules it", async () => {
  await transact("anshu", ask("t1"));
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE));
  // Arjun is blocked on KK.
  await transact("arjun", ask("b1", { assigneeId: "kk", blocksId: "t1", branchedFromId: "t1" }));
  const blocked = await thread("t1");
  expect(blocked.status).toBe("blocked");
  expect(blocked.schedule).toBeNull();
  expect(activity(blocked).at(-1)).toBe("is blocked on [[thread:b1]]");
  expect((await thread("b1")).assignee?.id).toBe("kk");
  // KK closes it: Arjun's thread is open again and back on his schedule.
  await transact("kk", [update("b1", { status: "closed" })]);
  const unblocked = await thread("t1");
  expect(unblocked.status).toBe("open");
  expect(unblocked.schedule).toEqual(slotAt(NINE));
  expect(activity(unblocked).at(-1)).toBe("is unblocked, [[thread:b1]] is closed");
});

test("a thread with two blockers stays blocked until both close", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", ask("b1", { assigneeId: "kk", blocksId: "t1" }));
  await transact("arjun", ask("b2", { assigneeId: "anshu", blocksId: "t1" }));
  await transact("kk", [update("b1", { status: "closed" })]);
  expect((await thread("t1")).status).toBe("blocked");
  await transact("anshu", [update("b2", { status: "closed" })]);
  expect((await thread("t1")).status).toBe("open");
});

const replies = (subject: Thread, personId: string) =>
  subject.replyBlocks
    .filter((reply) => reply.personId === personId)
    .map(({ startMs, endMs }) => ({ startMs, endMs }));

test("a question gets a reply block on the asked person's schedule, ahead of their own work", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", ask("theirs", { assigneeId: "anshu" }));
  expect((await thread("theirs")).schedule).toEqual(slotAt(NINE));
  // Arjun asks Anshu something in Anshu's ask: Anshu gets half an hour to answer, first thing.
  await transact("arjun", [
    message("q1", "t1", "[[person:anshu]] what do you need more help with?"),
  ]);
  expect(replies(await thread("t1"), "anshu")).toEqual([slotAt(NINE)]);
  expect((await thread("theirs")).schedule).toEqual(slotAt(NINE + HALF_HOUR));
  // Arjun's own block stays put.
  expect((await thread("t1")).schedule).toEqual(slotAt(NINE));
  // Asking again doesn't add another block.
  await transact("arjun", [message("q2", "t1", "[[person:anshu]] also, by when?")]);
  expect(replies(await thread("t1"), "anshu")).toEqual([slotAt(NINE)]);
  // Anshu answers: the reply block goes and her own work moves back up.
  await transact("anshu", [message("a1", "t1", "The final copy, by Friday")]);
  expect(replies(await thread("t1"), "anshu")).toEqual([]);
  expect((await thread("theirs")).schedule).toEqual(slotAt(NINE));
});

test("a question lands at the next break, never in the next half hour", async () => {
  await transact("anshu", ask("t1"));
  clock = NINE + 10 * 60_000;
  await transact("arjun", [message("q1", "t1", "[[person:anshu]] quick question")]);
  expect(replies(await thread("t1"), "anshu")).toEqual([slotAt(NINE + HOUR)]);
});

test("closing a thread clears the time set aside to answer questions in it", async () => {
  await transact("anshu", ask("t1"));
  await transact("arjun", [message("q1", "t1", "[[person:kk]] can you weigh in?")]);
  expect(replies(await thread("t1"), "kk")).toHaveLength(1);
  await transact("arjun", [update("t1", { status: "closed" })]);
  expect((await thread("t1")).replyBlocks).toEqual([]);
});
