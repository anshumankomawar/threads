import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { groupToken, personToken } from "../convex/text";
import { world } from "./world";

async function setup() {
  const { t, signUp } = world();
  const ada = await signUp("ada");
  const grace = await signUp("grace", ada);
  const linus = await signUp("linus", ada);
  const eve = await signUp("eve");
  const inbox = async (who: typeof ada) =>
    (await who.as.query(api.threads.list)).filter((row) => row.inbox);
  return { t, ada, grace, linus, eve, inbox };
}

test("a new thread reaches who it mentions, not who wrote it", async () => {
  const { ada, grace, linus, inbox } = await setup();
  await ada.as.mutation(api.threads.start, { body: `${personToken(grace._id)} lunch?\nat noon` });

  expect(await inbox(ada)).toEqual([]);
  expect(await ada.as.query(api.threads.list)).toMatchObject([{ title: "lunch?", unread: false }]);
  expect(await inbox(grace)).toMatchObject([{ title: "lunch?", unread: true }]);
  expect(await linus.as.query(api.threads.list)).toEqual([]);
});

test("a thread needs someone besides its author", async () => {
  const { ada, grace } = await setup();
  const start = (body: string) => ada.as.mutation(api.threads.start, { body });
  await expect(start("note to self")).rejects.toThrow();
  await expect(start(`${personToken(ada._id)} note to self`)).rejects.toThrow();
  expect(await ada.as.query(api.threads.list)).toEqual([]);
  await start(`${personToken(grace._id)} hi`);
  expect(await ada.as.query(api.threads.list)).toHaveLength(1);
});

test("a message reaches everyone in the thread but its author", async () => {
  const { ada, grace, inbox } = await setup();
  const threadId = await ada.as.mutation(api.threads.start, {
    body: `${personToken(grace._id)} hi`,
  });
  await grace.as.mutation(api.threads.send, { threadId, body: "hello" });

  expect(await inbox(ada)).toMatchObject([{ unread: true, lastBody: "hello" }]);
  expect(await inbox(grace)).toMatchObject([{ unread: false }]);
});

test("done keeps a thread out of the inbox until its next message", async () => {
  const { ada, grace, inbox } = await setup();
  const threadId = await ada.as.mutation(api.threads.start, {
    body: `${personToken(grace._id)} hi`,
  });
  await grace.as.mutation(api.threads.mark, { threadId, inbox: false });
  expect(await inbox(grace)).toEqual([]);

  await ada.as.mutation(api.threads.send, { threadId, body: "still there?" });
  expect(await inbox(grace)).toHaveLength(1);
});

test("mentioning a group brings in everyone in it", async () => {
  const { t, ada, grace, linus, inbox } = await setup();
  await ada.as.mutation(api.workspace.saveGroup, {
    name: "design",
    userIds: [grace._id, linus._id],
  });
  const [group] = await t.run((ctx) => ctx.db.query("groups").collect());
  await ada.as.mutation(api.threads.start, { body: `${groupToken(group._id)} review?` });

  expect(await inbox(grace)).toHaveLength(1);
  expect(await inbox(linus)).toHaveLength(1);
});

test("threads stay inside their workspace and their members", async () => {
  const { ada, grace, linus, eve } = await setup();
  const threadId = await ada.as.mutation(api.threads.start, {
    body: `${personToken(grace._id)} ${personToken(eve._id)} secret plans`,
  });

  expect(await eve.as.query(api.threads.list)).toEqual([]);
  await expect(eve.as.query(api.threads.messages, { threadId })).rejects.toThrow();
  await expect(linus.as.query(api.threads.messages, { threadId })).rejects.toThrow();
  await expect(linus.as.mutation(api.threads.send, { threadId, body: "hi" })).rejects.toThrow();
  expect(await linus.as.query(api.threads.search, { text: "secret" })).toEqual([]);
  expect(await grace.as.query(api.threads.search, { text: "secret" })).toHaveLength(1);
});
