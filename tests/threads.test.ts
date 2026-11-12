import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";
import { groupToken, personToken } from "../convex/text";

const modules = import.meta.glob("../convex/**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const workspace = (name: string) => t.run((ctx) => ctx.db.insert("workspaces", { name }));
  const person = async (name: string, workspaceId: Id<"workspaces">) => {
    const id = await t.run((ctx) =>
      ctx.db.insert("users", { name, email: `${name}@acme.com`, workspaceId }),
    );
    return { id, as: t.withIdentity({ subject: `${id}|session` }) };
  };
  const acme = await workspace("Acme");
  const ada = await person("ada", acme);
  const grace = await person("grace", acme);
  const linus = await person("linus", acme);
  const eve = await person("eve", await workspace("Other"));
  const inbox = async (who: typeof ada) =>
    (await who.as.query(api.threads.list)).filter((row) => row.inbox);
  return { t, acme, ada, grace, linus, eve, inbox };
}

test("a new thread reaches who it mentions, not who wrote it", async () => {
  const { ada, grace, linus, inbox } = await setup();
  await ada.as.mutation(api.threads.start, { body: `${personToken(grace.id)} lunch?\nat noon` });

  expect(await inbox(ada)).toEqual([]);
  expect(await ada.as.query(api.threads.list)).toMatchObject([{ title: "lunch?", unread: false }]);
  expect(await inbox(grace)).toMatchObject([{ title: "lunch?", unread: true }]);
  expect(await linus.as.query(api.threads.list)).toEqual([]);
});

test("a message reaches everyone in the thread but its author", async () => {
  const { ada, grace, inbox } = await setup();
  const threadId = await ada.as.mutation(api.threads.start, {
    body: `${personToken(grace.id)} hi`,
  });
  await grace.as.mutation(api.threads.send, { threadId, body: "hello" });

  expect(await inbox(ada)).toMatchObject([{ unread: true, lastBody: "hello" }]);
  expect(await inbox(grace)).toMatchObject([{ unread: false }]);
});

test("done keeps a thread out of the inbox until its next message", async () => {
  const { ada, grace, inbox } = await setup();
  const threadId = await ada.as.mutation(api.threads.start, {
    body: `${personToken(grace.id)} hi`,
  });
  await grace.as.mutation(api.threads.mark, { threadId, inbox: false });
  expect(await inbox(grace)).toEqual([]);

  await ada.as.mutation(api.threads.send, { threadId, body: "still there?" });
  expect(await inbox(grace)).toHaveLength(1);
});

test("mentioning a group brings in everyone in it", async () => {
  const { t, acme, ada, grace, linus, inbox } = await setup();
  const group = await t.run((ctx) =>
    ctx.db.insert("groups", { workspaceId: acme, name: "design", userIds: [grace.id, linus.id] }),
  );
  await ada.as.mutation(api.threads.start, { body: `${groupToken(group)} review?` });

  expect(await inbox(grace)).toHaveLength(1);
  expect(await inbox(linus)).toHaveLength(1);
});

test("threads stay inside their workspace and their members", async () => {
  const { ada, grace, linus, eve } = await setup();
  const threadId = await ada.as.mutation(api.threads.start, {
    body: `${personToken(grace.id)} ${personToken(eve.id)} secret plans`,
  });

  expect(await eve.as.query(api.threads.list)).toEqual([]);
  await expect(eve.as.query(api.threads.messages, { threadId })).rejects.toThrow();
  await expect(linus.as.query(api.threads.messages, { threadId })).rejects.toThrow();
  await expect(linus.as.mutation(api.threads.send, { threadId, body: "hi" })).rejects.toThrow();
  expect(await linus.as.query(api.threads.search, { text: "secret" })).toEqual([]);
  expect(await grace.as.query(api.threads.search, { text: "secret" })).toHaveLength(1);
});
