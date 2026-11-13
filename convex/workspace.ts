import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation as rawMutation, query as rawQuery } from "./_generated/server";
import { mutation, query, signedIn } from "./functions";

export const me = rawQuery({
  args: {},
  handler: async (ctx) => {
    const me = await signedIn(ctx);
    const workspace = me.workspaceId && (await ctx.db.get(me.workspaceId));
    return { ...me, workspace: workspace?.name };
  },
});

export const create = rawMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const me = await signedIn(ctx);
    if (me.workspaceId) throw new ConvexError("Already in a workspace");
    await ctx.db.patch(me._id, { workspaceId: await ctx.db.insert("workspaces", { name }) });
  },
});

export const join = rawMutation({
  args: { link: v.string() },
  handler: async (ctx, { link }) => {
    const me = await signedIn(ctx);
    if (me.workspaceId) throw new ConvexError("Already in a workspace");
    const invite = link.trim().split("/").pop();
    const workspace =
      invite &&
      (await ctx.db
        .query("workspaces")
        .withIndex("invite", (q) => q.eq("invite", invite))
        .unique());
    if (workspace) await ctx.db.patch(me._id, { workspaceId: workspace._id });
    return !!workspace;
  },
});

export const inviteLink = mutation({
  args: {},
  handler: async (ctx) => {
    const workspace = (await ctx.db.get(ctx.me.workspaceId))!;
    const invite = workspace.invite ?? crypto.randomUUID();
    if (!workspace.invite) await ctx.db.patch(workspace._id, { invite });
    return `arcthreads://join/${invite}`;
  },
});

export const people = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("users")
      .withIndex("workspace", (q) => q.eq("workspaceId", ctx.me.workspaceId))
      .collect(),
});

export const groups = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("groups")
      .withIndex("workspace", (q) => q.eq("workspaceId", ctx.me.workspaceId))
      .collect(),
});

export const saveGroup = mutation({
  args: { id: v.optional(v.id("groups")), name: v.string(), userIds: v.array(v.id("users")) },
  handler: async (ctx, { id, ...group }) => {
    const { workspaceId } = ctx.me;
    const users = await Promise.all(group.userIds.map((userId) => ctx.db.get(userId)));
    if (users.some((user) => user?.workspaceId !== workspaceId)) throw new ConvexError("Not found");
    if (!id) return void (await ctx.db.insert("groups", { workspaceId, ...group }));
    if ((await ctx.db.get(id))?.workspaceId !== workspaceId) throw new ConvexError("Not found");
    await ctx.db.patch(id, group);
  },
});

export const removeGroup = mutation({
  args: { id: v.id("groups") },
  handler: async (ctx, { id }) => {
    if ((await ctx.db.get(id))?.workspaceId !== ctx.me.workspaceId)
      throw new ConvexError("Not found");
    await ctx.db.delete(id);
  },
});

export const buckets = query({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("buckets")
      .withIndex("user", (q) => q.eq("userId", ctx.me._id))
      .collect(),
});

export const saveBucket = mutation({
  args: { id: v.optional(v.id("buckets")), name: v.string(), description: v.string() },
  handler: async (ctx, { id, ...bucket }) => {
    if (!id) return void (await ctx.db.insert("buckets", { userId: ctx.me._id, ...bucket }));
    if ((await ctx.db.get(id))?.userId !== ctx.me._id) throw new ConvexError("Not found");
    await ctx.db.patch(id, bucket);
  },
});

export const removeBucket = mutation({
  args: { id: v.id("buckets") },
  handler: async (ctx, { id }) => {
    if ((await ctx.db.get(id))?.userId !== ctx.me._id) throw new ConvexError("Not found");
    await ctx.db.delete(id);
    const rows = await ctx.db
      .query("members")
      .withIndex("user", (q) => q.eq("userId", ctx.me._id).eq("workspaceId", ctx.me.workspaceId))
      .collect();
    for (const row of rows.filter((row) => row.bucketId === id)) {
      await ctx.db.patch(row._id, { bucketId: undefined });
      await ctx.scheduler.runAfter(0, internal.ai.sort, { memberId: row._id });
    }
  },
});
