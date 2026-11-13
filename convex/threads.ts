import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { membership, mutation, query, type Ctx } from "./functions";
import { mentions, titleOf } from "./text";

export async function post(ctx: MutationCtx & Ctx, threadId: Id<"threads">, body: string) {
  const { _id: authorId, workspaceId } = ctx.me;
  const activeAt = Date.now();
  const messageId = await ctx.db.insert("messages", { workspaceId, threadId, authorId, body });
  await ctx.scheduler.runAfter(0, internal.search.index, { messageId });
  await ctx.db.patch(threadId, { lastAuthorId: authorId, lastBody: body });

  const colleague = async (id: string) => {
    const userId = ctx.db.normalizeId("users", id);
    const user = userId && (await ctx.db.get(userId));
    return user?.workspaceId === workspaceId ? [user._id] : [];
  };
  const groups = await Promise.all(
    mentions(body, "group").map((id) => {
      const groupId = ctx.db.normalizeId("groups", id);
      return groupId && ctx.db.get(groupId);
    }),
  );
  const mentioned = [
    ...mentions(body, "person"),
    ...groups.flatMap((group) => (group?.workspaceId === workspaceId ? group.userIds : [])),
  ];
  const rows = await ctx.db
    .query("members")
    .withIndex("thread", (q) => q.eq("threadId", threadId))
    .collect();
  const existing = new Map(rows.map((row) => [row.userId, row]));
  const everyone = new Set([
    authorId,
    ...existing.keys(),
    ...(await Promise.all(mentioned.map(colleague))).flat(),
  ]);

  for (const userId of everyone) {
    const row = existing.get(userId);
    const memberId =
      row?._id ??
      (await ctx.db.insert("members", {
        workspaceId,
        threadId,
        userId,
        activeAt,
        inbox: false,
        unread: false,
      }));
    if (userId === authorId) {
      await ctx.db.patch(memberId, { activeAt, unread: false });
      continue;
    }
    await ctx.db.patch(memberId, { activeAt, inbox: true, unread: true });
    if (!row?.bucketId) await ctx.scheduler.runAfter(0, internal.ai.sort, { memberId });
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("members")
      .withIndex("user", (q) => q.eq("userId", ctx.me._id).eq("workspaceId", ctx.me.workspaceId))
      .order("desc")
      .take(500);
    return Promise.all(
      rows.map(async ({ threadId, activeAt, inbox, unread, bucketId }) => {
        const { title, lastAuthorId, lastBody } = (await ctx.db.get(threadId))!;
        return { threadId, activeAt, inbox, unread, bucketId, title, lastAuthorId, lastBody };
      }),
    );
  },
});

export const messages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    await membership(ctx, threadId);
    return ctx.db
      .query("messages")
      .withIndex("thread", (q) => q.eq("threadId", threadId))
      .collect();
  },
});

export const search = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const hits = await ctx.db
      .query("messages")
      .withSearchIndex("search", (q) =>
        q.search("body", text).eq("workspaceId", ctx.me.workspaceId),
      )
      .take(50);
    const mine = await Promise.all(
      hits.map((hit) =>
        membership(ctx, hit.threadId).then(
          () => [hit],
          () => [],
        ),
      ),
    );
    return mine.flat().slice(0, 20);
  },
});

export async function begin(ctx: MutationCtx & Ctx, body: string) {
  const threadId = await ctx.db.insert("threads", {
    workspaceId: ctx.me.workspaceId,
    title: titleOf(body),
    lastAuthorId: ctx.me._id,
    lastBody: body,
  });
  await post(ctx, threadId, body);
  return threadId;
}

export const start = mutation({
  args: { body: v.string() },
  handler: (ctx, { body }) => begin(ctx, body),
});

export const send = mutation({
  args: { threadId: v.id("threads"), body: v.string() },
  handler: async (ctx, { threadId, body }) => {
    await membership(ctx, threadId);
    await post(ctx, threadId, body);
  },
});

export const mark = mutation({
  args: {
    threadId: v.id("threads"),
    inbox: v.optional(v.boolean()),
    unread: v.optional(v.boolean()),
  },
  handler: async (ctx, { threadId, ...state }) => {
    const row = await membership(ctx, threadId);
    await ctx.db.patch(row._id, state);
  },
});

export const move = mutation({
  args: { threadId: v.id("threads"), bucketId: v.optional(v.id("buckets")) },
  handler: async (ctx, { threadId, bucketId }) => {
    const row = await membership(ctx, threadId);
    const bucket = bucketId && (await ctx.db.get(bucketId));
    if (bucketId && bucket?.userId !== ctx.me._id) throw new ConvexError("Not found");
    await ctx.db.patch(row._id, { bucketId });
  },
});
