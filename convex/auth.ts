import { setupGoogle, vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import { setupConvexAuth } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const BUCKETS = [
  ["Reviews", "Someone wants me to review something: code, a design, a spec or a document."],
  ["Requests", "Someone needs something else from me: an answer, a fix, a decision or a task."],
  ["Social", "Nothing is asked of me: banter, plans, celebrations, news and announcements."],
];

const auth = setupConvexAuth({ component: components.auth });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(auth, {
  component: components.authGoogle,
  allowedRedirectOrigins: ["http://127.0.0.1:47201"],
}).attachUserCallbacks({ createUser: internal.auth.createUser });

const method = v.object({ name: v.literal("google"), profile: vGoogleProfile });

export const createUser = internalMutation({
  args: { method },
  returns: v.id("users"),
  handler: async (ctx, { method: { profile } }) => {
    const userId = await ctx.db.insert("users", {
      name: profile.name ?? "",
      email: profile.email ?? "",
    });
    for (const [name, description] of BUCKETS)
      await ctx.db.insert("buckets", { userId, name, description });
    return userId;
  },
});
