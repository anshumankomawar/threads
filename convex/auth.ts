import { setupGoogle, vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import { setupConvexAuth } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

const BUCKETS = [
  ["Messages that require action", "Someone is asking me to do, decide or answer something."],
  ["Messages to read", "Updates and conversations I only need to follow."],
];

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(auth, {
  component: components.authGoogle,
  allowedRedirectOrigins: ["http://127.0.0.1:47201"],
}).attachUserCallbacks({ createUser: internal.auth.createUser, onSignIn: internal.auth.onSignIn });

const method = v.object({ name: v.literal("google"), profile: vGoogleProfile });

async function invitedTo(ctx: MutationCtx, email: string) {
  const invite = await ctx.db
    .query("invites")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  if (invite) await ctx.db.delete(invite._id);
  return invite?.workspaceId;
}

export const createUser = internalMutation({
  args: { method },
  returns: v.id("users"),
  handler: async (ctx, { method: { profile } }) => {
    const name = profile.name ?? "";
    const email = profile.emailVerified ? (profile.email ?? "").toLowerCase() : "";
    const workspaceId =
      (email && (await invitedTo(ctx, email))) ||
      (await ctx.db.insert("workspaces", { name: name && `${name}'s workspace` }));
    const userId = await ctx.db.insert("users", { name, email, workspaceId });
    for (const [name, description] of BUCKETS)
      await ctx.db.insert("buckets", { userId, name, description });
    return userId;
  },
});

export const onSignIn = internalMutation({
  args: { method, userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const { email } = (await ctx.db.get(userId))!;
    const workspaceId = await invitedTo(ctx, email);
    if (workspaceId) await ctx.db.patch(userId, { workspaceId });
    return null;
  },
});
