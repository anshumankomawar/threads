import { sampleThreads } from "model";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApp } from "../src/app.ts";

// A fixed clock: Monday 2026-11-02, 08:00 UTC, before the workday starts.
const NOW = Date.UTC(2026, 10, 2, 8);
const DATE = "2026-11-02";
const at = (hour: number, minute = 0): number => Date.UTC(2026, 10, 2, hour, minute);

let app: ReturnType<typeof createApp>;
let clock: number;

beforeEach(() => {
  clock = NOW;
  app = createApp({ now: () => clock });
});

function send(method: string, path: string, body?: unknown): Response | Promise<Response> {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Body = {
  id: string;
  error: string;
  userId: string;
  entries: { id: string; kind: string; text?: string; decision?: boolean }[];
  items: { id: string }[];
};

const read = (response: Response): Promise<Body> => response.json() as Promise<Body>;

async function createUser(firstName = "Priya"): Promise<string> {
  const response = await send("POST", "/users", {
    firstName,
    lastName: "Shah",
    level: "l3",
    role: "sde",
  });
  expect(response.status).toBe(201);
  return (await read(response)).id;
}

async function createThread(creator: string, recipient: string, text = "Review"): Promise<string> {
  const response = await send("POST", "/threads", { creator, assignee: recipient, text });
  expect(response.status).toBe(201);
  return (await read(response)).id;
}

const edit = (id: string, actor: string, edits: object): Promise<Response> =>
  Promise.resolve(send("PATCH", `/threads/${id}`, { actor, ...edits }));

test("the root route responds", async () => {
  const response = await send("GET", "/");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello Hono!");
});

test("createUser returns the person with an id and full name", async () => {
  const response = await send("POST", "/users", {
    firstName: "Priya",
    lastName: "Shah",
    level: "l2",
    role: "pm",
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    id: expect.any(String),
    name: "Priya Shah",
    level: "l2",
    role: "pm",
  });
});

test("createUser can place the person under a manager, who must exist", async () => {
  const manager = await createUser();
  const fields = { firstName: "Sam", lastName: "Rivera", level: "l1", role: "sde" };
  const response = await send("POST", "/users", { ...fields, manager });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ name: "Sam Rivera", managerId: manager });
  expect((await send("POST", "/users", { ...fields, manager: "nobody" })).status).toBe(404);
});

test.each([
  ["a bad level", { level: "senior", role: "sde" }],
  ["a bad role", { level: "l1", role: "ceo" }],
  ["a missing role", { level: "l1" }],
])("createUser rejects %s", async (_, fields) => {
  const response = await send("POST", "/users", { firstName: "A", lastName: "B", ...fields });
  expect(response.status).toBe(400);
  expect((await read(response)).error).toEqual(expect.any(String));
});

test("createThread opens a thread titled from the first line of the message", async () => {
  const [creator, recipient] = [await createUser(), await createUser("Sam")];
  const response = await send("POST", "/threads", {
    creator,
    assignee: recipient,
    text: "Can you review the rate limits?\nDetails below.",
  });
  expect(response.status).toBe(201);
  const thread = await read(response);
  expect(thread).toMatchObject({
    kind: "response",
    requester: { id: creator },
    assignee: { id: recipient },
    title: "Can you review the rate limits?",
    status: "open",
    attendees: [],
    updatedAtMs: NOW,
  });
  expect(thread.entries).toEqual([
    {
      kind: "message",
      id: expect.any(String),
      author: expect.objectContaining({ id: creator }),
      text: "Can you review the rate limits?\nDetails below.",
      createdAtMs: NOW,
      decision: false,
    },
  ]);
});

test("createThread rejects unknown users", async () => {
  const creator = await createUser();
  const response = await send("POST", "/threads", { creator, assignee: "nobody", text: "Hello" });
  expect(response.status).toBe(404);
  expect((await read(response)).error).toContain("nobody");
});

test("getThread returns the thread, or 404", async () => {
  const user = await createUser();
  const id = await createThread(user, user);
  expect(await (await send("GET", `/threads/${id}`)).json()).toMatchObject({ id });
  expect((await send("GET", "/threads/nope")).status).toBe(404);
});

test("editThread changes only the given fields and bumps updatedAtMs", async () => {
  const [creator, recipient] = [await createUser(), await createUser("Sam")];
  const id = await createThread(creator, recipient);
  clock = NOW + 1000;

  const response = await edit(id, recipient, { status: "waiting", dueAtMs: at(17) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id,
    title: "Review",
    assignee: { id: recipient },
    status: "waiting",
    dueAtMs: at(17),
    updatedAtMs: NOW + 1000,
  });
  expect(await (await send("GET", `/threads/${id}`)).json()).toMatchObject({ status: "waiting" });
});

test("editThread reassigns to another user and clears nullable fields", async () => {
  const [creator, recipient] = [await createUser(), await createUser("Sam")];
  const id = await createThread(creator, recipient);
  await edit(id, creator, { dueAtMs: at(17) });

  const response = await edit(id, creator, { assignee: creator, dueAtMs: null });
  expect(await response.json()).toMatchObject({ assignee: { id: creator }, dueAtMs: null });
});

test("editThread records an activity line for each change, and none for no-ops", async () => {
  const [creator, recipient] = [await createUser(), await createUser("Sam")];
  const id = await createThread(creator, recipient);
  await edit(id, recipient, { status: "in_progress", priority: "high" });
  await edit(id, recipient, { status: "in_progress" });
  await edit(id, recipient, { assignee: recipient });
  await edit(id, recipient, { status: "done" });
  const thread = await read(await edit(id, creator, { status: "open" }));
  expect(
    thread.entries.filter((entry) => entry.kind === "event").map((entry) => entry.text),
  ).toEqual([
    "changed status to In progress",
    "set priority to High",
    "changed status to Done",
    "reopened this",
  ]);
});

test.each([
  ["no fields", {}],
  ["an unknown field", { statuss: "done" }],
  ["a bad status", { status: "closed" }],
  ["a backwards schedule", { schedule: { startMs: 2, endMs: 1 } }],
])("editThread rejects %s", async (_, body) => {
  const user = await createUser();
  const id = await createThread(user, user);
  expect((await edit(id, user, body)).status).toBe(400);
});

test("editThread returns 404 for an unknown thread, assignee or actor", async () => {
  const user = await createUser();
  const id = await createThread(user, user);
  expect((await edit("nope", user, { status: "done" })).status).toBe(404);
  expect((await edit(id, user, { assignee: "nobody" })).status).toBe(404);
  expect((await edit(id, "nobody", { status: "done" })).status).toBe(404);
});

test("createInbox makes one inbox per known user", async () => {
  const user = await createUser();
  const created = await send("POST", "/inboxes", { userId: user });
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ id: expect.any(String), userId: user, createdAtMs: NOW });
  expect((await send("POST", "/inboxes", { userId: user })).status).toBe(409);
  expect((await send("POST", "/inboxes", { userId: "nobody" })).status).toBe(404);
});

test("getInbox lists the user's open threads, most pressing first", async () => {
  const [creator, user] = [await createUser(), await createUser("Sam")];
  await send("POST", "/inboxes", { userId: user });
  const plain = await createThread(creator, user, "plain");
  const dueLate = await createThread(creator, user, "due late");
  const dueSoon = await createThread(creator, user, "due soon");
  const urgent = await createThread(creator, user, "urgent");
  const done = await createThread(creator, user, "done");
  await createThread(user, creator, "someone else's");
  await edit(dueLate, user, { dueAtMs: at(17) });
  await edit(dueSoon, user, { dueAtMs: at(10) });
  await edit(urgent, user, { priority: "urgent" });
  await edit(done, user, { status: "done" });

  const inbox = await read(await send("GET", `/inboxes/${user}`));
  expect(inbox.userId).toBe(user);
  expect(inbox.items.map((item) => item.id)).toEqual([urgent, dueSoon, dueLate, plain]);
  expect(inbox.items[0]).not.toHaveProperty("entries");
});

test("only a new meeting gets a video call, with the dummy Zoom link", async () => {
  const user = await createUser();
  const create = async (kind: string): Promise<Body> =>
    read(await send("POST", "/threads", { kind, creator: user, text: "Text" }));
  const entryKinds = (thread: Body): string[] => thread.entries.map((entry) => entry.kind);

  const meeting = await create("meeting");
  expect(entryKinds(meeting)).toEqual(["message", "call"]);
  expect(meeting.entries[1]).toMatchObject({ kind: "call", link: "zoom.us/j/0000000000" });
  expect(entryKinds(await create("response"))).toEqual(["message"]);
  expect(entryKinds(await create("focus"))).toEqual(["message"]);
});

test("the sample meetings all have the dummy Zoom link", async () => {
  const links = sampleThreads({ id: "me", name: "You" }, NOW)
    .filter((thread) => thread.kind === "meeting")
    .map((thread) => thread.entries.find((entry) => entry.kind === "call"));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link).toMatchObject({ link: "zoom.us/j/0000000000" });
});

test("getInbox follows whose turn it is as people reply", async () => {
  const [asker, assignee] = [await createUser(), await createUser("Sam")];
  await send("POST", "/inboxes", { userId: asker });
  await send("POST", "/inboxes", { userId: assignee });
  const id = await createThread(asker, assignee);
  const inboxOf = async (user: string): Promise<string[]> =>
    (await read(await send("GET", `/inboxes/${user}`))).items.map((item) => item.id);
  const reply = (author: string): Response | Promise<Response> =>
    send("POST", `/threads/${id}/entries`, { kind: "message", author, text: "Reply" });

  expect(await inboxOf(assignee)).toEqual([id]);
  expect(await inboxOf(asker)).toEqual([]);

  await reply(assignee);
  expect(await inboxOf(asker)).toEqual([id]);
  expect(await inboxOf(assignee)).toEqual([]);

  await reply(asker);
  expect(await inboxOf(assignee)).toEqual([id]);
  expect(await inboxOf(asker)).toEqual([]);
});

test("getInbox returns 404 until the inbox is created", async () => {
  const user = await createUser();
  expect((await send("GET", `/inboxes/${user}`)).status).toBe(404);
});

test("getSchedule keeps user-set times and fits other threads around them", async () => {
  const [creator, user] = [await createUser(), await createUser("Sam")];
  const fixed = await createThread(creator, user, "fixed");
  const first = await createThread(creator, user, "first");
  const second = await createThread(creator, user, "second");
  const done = await createThread(creator, user, "done");
  const tomorrow = await createThread(creator, user, "tomorrow");
  await edit(fixed, user, { schedule: { startMs: at(9, 30), endMs: at(10, 15) } });
  await edit(first, user, { priority: "high" });
  await edit(done, user, { status: "done" });
  await edit(tomorrow, user, {
    schedule: { startMs: at(9) + 86_400_000, endMs: at(10) + 86_400_000 },
  });

  const response = await send("GET", `/users/${user}/schedule?date=${DATE}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    date: DATE,
    items: [
      { threadId: first, title: "first", startMs: at(9), endMs: at(9, 30), source: "auto" },
      { threadId: fixed, title: "fixed", startMs: at(9, 30), endMs: at(10, 15), source: "user" },
      { threadId: second, title: "second", startMs: at(10, 30), endMs: at(11), source: "auto" },
    ],
    unscheduled: [],
  });
});

test("getSchedule defaults to today and places nothing before the current time", async () => {
  const user = await createUser();
  const id = await createThread(user, user);
  clock = at(14, 10);

  expect(await (await send("GET", `/users/${user}/schedule`)).json()).toMatchObject({
    date: DATE,
    items: [{ threadId: id, startMs: at(14, 30), endMs: at(15), source: "auto" }],
  });
});

test("getSchedule lists threads that don't fit in the workday as unscheduled", async () => {
  const user = await createUser();
  const id = await createThread(user, user);
  clock = at(17, 45);

  expect(await (await send("GET", `/users/${user}/schedule`)).json()).toEqual({
    date: DATE,
    items: [],
    unscheduled: [{ threadId: id, title: "Review" }],
  });
});

test("getSchedule rejects bad dates and unknown users", async () => {
  const user = await createUser();
  expect((await send("GET", `/users/${user}/schedule?date=2026-13-45`)).status).toBe(400);
  expect((await send("GET", "/users/nobody/schedule")).status).toBe(404);
});

test("createThread makes a meeting with you and the invitees, at the chosen time", async () => {
  const [creator, sam, maya] = [
    await createUser(),
    await createUser("Sam"),
    await createUser("Maya"),
  ];
  const schedule = { startMs: at(10), endMs: at(10, 30) };
  const response = await send("POST", "/threads", {
    kind: "meeting",
    creator,
    text: "Pricing sync",
    invitees: [sam, maya],
    schedule,
  });
  expect(await response.json()).toMatchObject({
    kind: "meeting",
    assignee: null,
    schedule,
    attendees: [{ id: creator }, { id: sam }, { id: maya }],
  });
});

test("createThread makes a focus block yours", async () => {
  const user = await createUser();
  const response = await send("POST", "/threads", { kind: "focus", creator: user, text: "Draft" });
  expect(await response.json()).toMatchObject({ kind: "focus", assignee: { id: user } });
});

test("addEntry appends a reply, and a resolution marks the thread done", async () => {
  const [creator, recipient] = [await createUser(), await createUser("Sam")];
  const id = await createThread(creator, recipient);
  clock = NOW + 1000;

  const reply = await send("POST", `/threads/${id}/entries`, {
    kind: "message",
    author: recipient,
    text: "On it",
  });
  expect(reply.status).toBe(201);
  expect(await reply.json()).toMatchObject({ status: "open", updatedAtMs: NOW + 1000 });

  const resolved = await read(
    await send("POST", `/threads/${id}/entries`, {
      kind: "resolution",
      author: recipient,
      text: "Shipped",
    }),
  );
  expect(resolved).toMatchObject({ status: "done" });
  expect(resolved.entries.map((entry) => entry.kind)).toEqual(["message", "message", "resolution"]);
});

test("editEntry bookmarks a message as a decision, and only messages", async () => {
  const user = await createUser();
  const id = await createThread(user, user);
  const [first] = (await read(await send("GET", `/threads/${id}`))).entries;

  const thread = await read(
    await send("PATCH", `/threads/${id}/entries/${first.id}`, { decision: true }),
  );
  expect(thread.entries[0].decision).toBe(true);
  expect((await send("PATCH", `/threads/${id}/entries/nope`, { decision: true })).status).toBe(404);
});

test("the local workspace starts with a few people and no threads; the sample workspace has the team and their threads", async () => {
  app = createApp({ now: () => clock, me: { id: "me", name: "You" } });
  const get = async (path: string, workspace?: string): Promise<unknown> =>
    (
      await app.request(path, {
        headers: workspace === undefined ? {} : { "X-Workspace": workspace },
      })
    ).json();

  expect(await get("/users")).toEqual([
    { id: "anshu", name: "Anshu", level: "l1", managerId: "kk" },
    { id: "arjun", name: "Arjun", level: "l1", managerId: "kk" },
    { id: "kk", name: "KK", level: "l2" },
  ]);
  expect(await get("/threads")).toEqual([]);

  const people = (await get("/users", "sample")) as { id: string }[];
  expect(people[0]).toEqual({ id: "me", name: "You", managerId: "priya" });
  const threads = (await get("/threads", "sample")) as {
    id: string;
    assignee: { id: string } | null;
  }[];
  expect(threads.find((thread) => thread.id === "rate-limits")?.assignee?.id).toBe("me");
  expect((await app.request("/threads", { headers: { "X-Workspace": "nope" } })).status).toBe(400);
});
