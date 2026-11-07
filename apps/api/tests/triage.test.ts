import { threadsServer } from "models/server";
import { memoryStorage, type Session } from "server";
import { beforeEach, expect, test } from "vite-plus/test";
import {
  parseTriage,
  triagePrompt,
  Triager,
  type TriageRequest,
  type TriageResult,
} from "../src/triage.ts";

const admin: Session = { admin: true };
let server: ReturnType<typeof threadsServer>;
// Every request the fake model was asked, and how it answers: Northwind in the first bucket, the rest in the last.
let asked: TriageRequest[];
let failing: boolean;

const classify = async (request: TriageRequest): Promise<TriageResult[]> => {
  asked.push(request);
  if (failing) throw new Error("Model unavailable");
  return request.items.map((item) => ({
    itemId: item.id,
    bucketId: /northwind/i.test(item.title) ? request.buckets[0]!.id : request.buckets.at(-1)!.id,
    reason: ` About ${item.title.toLowerCase()} `,
  }));
};

beforeEach(() => {
  server = threadsServer(memoryStorage(), () => []);
  server.action(admin, "seed", "sample");
  asked = [];
  failing = false;
});

const rows = (model: string) =>
  server
    .bootstrap(admin)
    .rows.filter((line) => line.model === model)
    .map((line) => line.row);
const itemFor = (userId: string, threadId: string) =>
  rows("InboxItem").find((item) => item.userId === userId && item.threadId === threadId)!;
const bucketName = (id: unknown) => rows("Bucket").find((bucket) => bucket.id === id)?.name;

test("unsorted inbox items are sorted into their user's buckets, once", async () => {
  await new Triager(server, classify).kick();
  expect(rows("InboxItem").every((item) => item.bucketId !== undefined)).toBe(true);
  const northwind = itemFor("you", "northwind-sso");
  expect(bucketName(northwind.bucketId)).toBe("Messages that require action");
  expect(northwind.reason).toBe("About northwind can't sign in with okta since tuesday");
  expect(bucketName(itemFor("you", "search-pr").bucketId)).toBe("Messages to read");
  const count = asked.length;
  await new Triager(server, classify).kick();
  expect(asked).toHaveLength(count);
});

test("an item placed by hand isn't sorted, and is an example for the model", async () => {
  const item = itemFor("you", "search-pr");
  const action = rows("Bucket").find((bucket) => bucket.userId === "you" && bucket.position === 0)!;
  server.mutate(
    { userId: "you" },
    {
      transactions: [
        {
          id: "place",
          kind: "update",
          model: "InboxItem",
          modelId: item.id,
          changes: { bucketId: action.id, manual: true },
          batch: 0,
        },
      ],
    },
  );
  await new Triager(server, classify).kick();
  const mine = asked.find((request) => request.person.id === "you")!;
  expect(mine.items.map((i) => i.id)).not.toContain(item.id);
  expect(mine.examples).toEqual([
    { title: "Review: move search indexing to a queue", bucketId: action.id },
  ]);
  expect(itemFor("you", "search-pr")).toMatchObject({ bucketId: action.id, manual: true });
});

test("a failing model leaves items unsorted and waits before trying them again", async () => {
  let now = 0;
  const retries: number[] = [];
  const triager = new Triager(server, classify, {
    now: () => now,
    onFailure: (at) => retries.push(at),
  });
  failing = true;
  await triager.kick();
  const first = asked.length;
  expect(itemFor("you", "northwind-sso").bucketId).toBeUndefined();
  expect(retries.at(-1)).toBe(60_000);
  failing = false;
  await triager.kick();
  expect(asked).toHaveLength(first);
  now = 60_000;
  await triager.kick();
  expect(itemFor("you", "northwind-sso").bucketId).toBeDefined();
});

test("the prompt numbers buckets and items, says who sent it and what; answers map back to them", async () => {
  await new Triager(server, async (request) => (asked.push(request), [])).kick();
  const request = asked.find((r) => r.person.id === "you")!;
  const northwind = request.items.find((item) => item.title.startsWith("Northwind"))!;
  expect(northwind.from).toBe("Sam Rivera");
  expect(northwind.text).toContain("Tuesday's deploy changed the SAML audience");
  const prompt = triagePrompt(request);
  expect(prompt).toContain("Inbox of Jamie Lin.");
  expect(prompt).toContain("1. Messages that require action:");
  const index = request.items.indexOf(northwind) + 1;
  expect(
    parseTriage(
      request,
      `{"threads":[{"thread":${index},"bucket":2,"reason":"Login broken"},{"thread":99,"bucket":1,"reason":""}]}`,
    ),
  ).toEqual([{ itemId: northwind.id, bucketId: request.buckets[1]!.id, reason: "Login broken" }]);
});
