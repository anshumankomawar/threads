import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { plain } from "./text";

export const unsorted = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const row = await ctx.db.get(memberId);
    if (!row || row.bucketId) return null;
    const buckets = await ctx.db
      .query("buckets")
      .withIndex("user", (q) => q.eq("userId", row.userId))
      .collect();
    if (buckets.length === 0) return null;
    const thread = (await ctx.db.get(row.threadId))!;
    const latest = await ctx.db
      .query("messages")
      .withIndex("thread", (q) => q.eq("threadId", row.threadId))
      .order("desc")
      .take(5);
    const messages = latest
      .reverse()
      .map(({ body }) => plain(body, (kind, id) => (id === row.userId ? "me" : kind)));
    return { buckets, title: thread.title, messages };
  },
});

export const place = internalMutation({
  args: { memberId: v.id("members"), bucketId: v.id("buckets") },
  handler: async (ctx, { memberId, bucketId }) => {
    const row = await ctx.db.get(memberId);
    if (row && !row.bucketId) await ctx.db.patch(memberId, { bucketId });
  },
});

export const sort = internalAction({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const thread = await ctx.runQuery(internal.ai.unsorted, { memberId });
    if (!thread) return;
    const buckets = thread.buckets.map(({ _id, name, description }) => ({
      id: _id,
      name,
      description,
    }));
    const chosen = process.env.ANTHROPIC_API_KEY
      ? await choose(buckets, thread).catch(() => undefined)
      : undefined;
    await ctx.runMutation(internal.ai.place, { memberId, bucketId: chosen ?? buckets[0].id });
  },
});

async function choose(
  buckets: { id: Id<"buckets">; name: string; description: string }[],
  thread: { title: string; messages: string[] },
) {
  const response = await new Anthropic().beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { bucketId: { type: "string", enum: buckets.map((bucket) => bucket.id) } },
          required: ["bucketId"],
          additionalProperties: false,
        },
      },
    },
    system:
      "You sort a person's message threads into their buckets. Choose the bucket whose description fits the thread best. @me is the person you are sorting for.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({ buckets, title: thread.title, messages: thread.messages }),
      },
    ],
  });
  const answer = response.content.find((block) => block.type === "text");
  if (response.stop_reason === "end_turn" && answer)
    return JSON.parse(answer.text).bucketId as Id<"buckets">;
}
