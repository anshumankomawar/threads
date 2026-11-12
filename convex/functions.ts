import { getAuthUserId } from "@convex-dev/auth/server";
import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation as rawMutation, query as rawQuery, type QueryCtx } from "./_generated/server";

async function signedIn(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  const me = id && (await ctx.db.get(id));
  if (!me) throw new ConvexError("Signed out");
  return { me };
}

export const query = customQuery(rawQuery, customCtx(signedIn));
export const mutation = customMutation(rawMutation, customCtx(signedIn));

export type Ctx = QueryCtx & Awaited<ReturnType<typeof signedIn>>;

export async function membership(ctx: Ctx, threadId: Id<"threads">) {
  const row = await ctx.db
    .query("members")
    .withIndex("thread", (q) => q.eq("threadId", threadId).eq("userId", ctx.me._id))
    .unique();
  if (!row) throw new ConvexError("Not found");
  return row;
}
