import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { groupToken, personToken } from "./text";
import { begin, post } from "./threads";

const TEAM = ["Arjun Rao", "Maya Chen", "Diego Alvarez", "Priya Nair"];
const BACKLOG = 9;
const PACE = 20_000;

const SCRIPT: [from: string, thread: string, bucket: number, body: string][] = [
  [
    "Maya Chen",
    "launch",
    0,
    "@me can you review the launch checklist?\nI need a yes or no on the pricing page by Thursday.",
  ],
  [
    "Diego Alvarez",
    "launch",
    0,
    "I went through billing, two edge cases left. Notes are in the doc.",
  ],
  [
    "Priya Nair",
    "offsite",
    1,
    "@design offsite is the 14th and 15th.\nFlights are booked, hotel details coming tomorrow.",
  ],
  [
    "Arjun Rao",
    "sync",
    0,
    "@me the sync rewrite is ready for you to try. Does the schema still look right to you?",
  ],
  [
    "Maya Chen",
    "numbers",
    1,
    "@me weekly numbers: signups up 12%, churn flat. Nothing needed from you.",
  ],
  [
    "Diego Alvarez",
    "bug",
    0,
    "@me a customer says search misses messages older than a month. Can you take a look?",
  ],
  [
    "Priya Nair",
    "bug",
    0,
    "I can reproduce it. It only happens in workspaces created before March.",
  ],
  ["Arjun Rao", "lunch", 1, "@me @Maya want to get lunch on Friday?"],
  ["Maya Chen", "lunch", 1, "Yes. The noodle place?"],
  [
    "Arjun Rao",
    "sync",
    0,
    "@me also, should done threads come back on a reaction, or only on a message?",
  ],
  [
    "Priya Nair",
    "hiring",
    0,
    "@me can you do a design interview on Wednesday at 2?\nThe candidate is strong, I'd like your read.",
  ],
  [
    "Diego Alvarez",
    "launch",
    0,
    "@me billing edge cases are fixed. Only your pricing sign-off is left.",
  ],
  ["Maya Chen", "numbers", 1, "Correction: signups are up 14%, I had last week's column."],
  ["Arjun Rao", "lunch", 1, "Noodles it is. 12:30?"],
  [
    "Priya Nair",
    "offsite",
    1,
    "Hotel is the Alder, two blocks from the venue. @me you're in on the 13th.",
  ],
  [
    "Diego Alvarez",
    "bug",
    0,
    "@me found it: the search index skips rows with no workspace. Want me to backfill tonight?",
  ],
  ["Maya Chen", "launch", 0, "@me friendly nudge on pricing, Thursday is tomorrow."],
  ["Arjun Rao", "demo", 0, "@me @design demo is in 30 minutes. Can someone share their screen?"],
];

export const start = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const me = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), email))
      .unique();
    if (!me?.workspaceId) throw new Error(`No account in a workspace for ${email}`);
    const { workspaceId } = me;
    const userIds = [];
    for (const name of TEAM)
      userIds.push(
        await ctx.db.insert("users", {
          name,
          email: `${name.split(" ")[0].toLowerCase()}@example.com`,
          workspaceId,
        }),
      );
    await ctx.db.insert("groups", { workspaceId, name: "design", userIds: [me._id, ...userIds] });
    await ctx.scheduler.runAfter(0, internal.simulate.step, {
      meId: me._id,
      index: 0,
      threads: {},
    });
  },
});

export const step = internalMutation({
  args: { meId: v.id("users"), index: v.number(), threads: v.record(v.string(), v.id("threads")) },
  handler: async (ctx, { meId, index, threads }) => {
    const [from, key, bucket, text] = SCRIPT[index];
    const me = (await ctx.db.get(meId))!;
    const workspaceId = me.workspaceId!;
    const people = await ctx.db
      .query("users")
      .withIndex("workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const groups = await ctx.db
      .query("groups")
      .withIndex("workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const mention = (word: string) => {
      const person = word === "me" ? me : people.find(({ name }) => name.startsWith(word));
      const group = groups.find(({ name }) => name === word);
      return person ? personToken(person._id) : group ? groupToken(group._id) : `@${word}`;
    };
    const body = text.replace(/@(\w+)/g, (_match, word: string) => mention(word));
    const author = { ...ctx, me: { ...people.find(({ name }) => name === from)!, workspaceId } };
    const threadId = threads[key] ?? (await begin(author, body));
    if (threads[key]) await post(author, threadId, body);

    const buckets = await ctx.db
      .query("buckets")
      .withIndex("user", (q) => q.eq("userId", meId))
      .collect();
    const mine = await ctx.db
      .query("members")
      .withIndex("thread", (q) => q.eq("threadId", threadId).eq("userId", meId))
      .unique();
    if (mine && !mine.bucketId && buckets[bucket])
      await ctx.db.patch(mine._id, { bucketId: buckets[bucket]._id });

    if (index + 1 < SCRIPT.length)
      await ctx.scheduler.runAfter(index + 1 < BACKLOG ? 0 : PACE, internal.simulate.step, {
        meId,
        index: index + 1,
        threads: { ...threads, [key]: threadId },
      });
  },
});
