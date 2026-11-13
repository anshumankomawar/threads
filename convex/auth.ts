import { setupGoogle, vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import {
  setupUsernamePassword,
  type SignUpResult,
} from "@convex-dev/auth/methods/username-password/server";
import { setupConvexAuth } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";

const BUCKETS = [
  ["Messages that require action", "Someone is asking me to do, decide or answer something."],
  ["Messages to read", "Updates and conversations I only need to follow."],
];

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { signUpWithUsernamePassword, signInWithUsernamePassword } = setupUsernamePassword(
  auth,
  { component: components.authPassword, usernameComponent: components.authUsername },
).attachUserCallbacks({ createUser: internal.auth.createUser, onSignIn: internal.auth.onSignIn });

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(auth, {
  component: components.authGoogle,
  allowedRedirectOrigins: ["http://127.0.0.1:47201"],
}).attachUserCallbacks({ createUser: internal.auth.createUser, onSignIn: internal.auth.onSignIn });

const method = v.union(
  v.object({ name: v.literal("usernamePassword"), profile: v.object({}) }),
  v.object({ name: v.literal("google"), profile: vGoogleProfile }),
);

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
  handler: async (ctx, { method }) => {
    const google = method.name === "google" ? method.profile : undefined;
    const name = google?.name ?? "";
    const email = google?.emailVerified ? (google.email ?? "").toLowerCase() : "";
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

export const signUp = mutation({
  args: { name: v.string(), email: v.string(), password: v.string() },
  handler: async (ctx, { name, password, ...args }): Promise<SignUpResult> => {
    const email = args.email.trim().toLowerCase();
    const result: SignUpResult = await ctx.runMutation(api.auth.signUpWithUsernamePassword, {
      username: email,
      password,
    });
    if (result.status !== "complete") return result;
    const userId = result.tokens.userId as Id<"users">;
    const own = (await ctx.db.get(userId))!.workspaceId;
    const invited = await invitedTo(ctx, email);
    if (invited) await ctx.db.delete(own);
    else await ctx.db.patch(own, { name: `${name}'s workspace` });
    await ctx.db.patch(userId, { name, email, workspaceId: invited ?? own });
    return result;
  },
});
