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
  app = createApp(() => clock);
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
  messages: unknown[];
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
  const response = await send("POST", "/threads", {
    creator,
    recipient,
    initialMessage: text,
  });
  expect(response.status).toBe(201);
  return (await read(response)).id;
}

test("createUser returns the user with an id", async () => {
  const response = await send("POST", "/users", {
    firstName: "Priya",
    lastName: "Shah",
    level: "l2",
    role: "pm",
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    id: expect.any(String),
    firstName: "Priya",
    lastName: "Shah",
    level: "l2",
    role: "pm",
  });
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
    recipient,
    initialMessage: "Can you review the rate limits?\nDetails below.",
  });
  expect(response.status).toBe(201);
  const thread = await read(response);
  expect(thread).toMatchObject({
    creatorId: creator,
    recipientId: recipient,
    title: "Can you review the rate limits?",
    status: "open",
    createdAtMs: NOW,
  });
  expect(thread.messages).toEqual([
    {
      id: expect.any(String),
      authorId: creator,
      text: "Can you review the rate limits?\nDetails below.",
      createdAtMs: NOW,
    },
  ]);
});

test("createThread rejects unknown users", async () => {
  const creator = await createUser();
  const response = await send("POST", "/threads", {
    creator,
    recipient: "nobody",
    initialMessage: "Hello",
  });
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

  const response = await send("PATCH", `/threads/${id}`, { status: "waiting", dueAtMs: at(17) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id,
    title: "Review",
    recipientId: recipient,
    status: "waiting",
    dueAtMs: at(17),
    createdAtMs: NOW,
    updatedAtMs: NOW + 1000,
  });
  expect(await (await send("GET", `/threads/${id}`)).json()).toMatchObject({ status: "waiting" });
});

test("editThread reassigns to another user and clears nullable fields", async () => {
  const [creator, recipient] = [await createUser(), await createUser("Sam")];
  const id = await createThread(creator, recipient);
  await send("PATCH", `/threads/${id}`, { dueAtMs: at(17) });

  const response = await send("PATCH", `/threads/${id}`, { recipient: creator, dueAtMs: null });
  expect(await response.json()).toMatchObject({ recipientId: creator, dueAtMs: null });
});

test.each([
  ["no fields", {}],
  ["an unknown field", { statuss: "done" }],
  ["a bad status", { status: "closed" }],
  ["a backwards schedule", { schedule: { startMs: 2, endMs: 1 } }],
])("editThread rejects %s", async (_, body) => {
  const user = await createUser();
  const id = await createThread(user, user);
  expect((await send("PATCH", `/threads/${id}`, body)).status).toBe(400);
});

test("editThread returns 404 for an unknown thread or recipient", async () => {
  const user = await createUser();
  const id = await createThread(user, user);
  expect((await send("PATCH", "/threads/nope", { status: "done" })).status).toBe(404);
  expect((await send("PATCH", `/threads/${id}`, { recipient: "nobody" })).status).toBe(404);
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
  await send("PATCH", `/threads/${dueLate}`, { dueAtMs: at(17) });
  await send("PATCH", `/threads/${dueSoon}`, { dueAtMs: at(10) });
  await send("PATCH", `/threads/${urgent}`, { priority: "urgent" });
  await send("PATCH", `/threads/${done}`, { status: "done" });

  const inbox = await read(await send("GET", `/inboxes/${user}`));
  expect(inbox.userId).toBe(user);
  expect(inbox.items.map((item) => item.id)).toEqual([urgent, dueSoon, dueLate, plain]);
  expect(inbox.items[0]).not.toHaveProperty("messages");
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
  await send("PATCH", `/threads/${fixed}`, { schedule: { startMs: at(9, 30), endMs: at(10, 15) } });
  await send("PATCH", `/threads/${first}`, { priority: "high" });
  await send("PATCH", `/threads/${done}`, { status: "done" });
  await send("PATCH", `/threads/${tomorrow}`, {
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
