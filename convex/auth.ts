import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, createAccount } from "@convex-dev/auth/server";
import type { MutationCtx } from "./_generated/server";

const BUCKETS = [
  ["Messages that require action", "Someone is asking me to do, decide or answer something."],
  ["Messages to read", "Updates and conversations I only need to follow."],
];

const dev = ConvexCredentials({
  id: "dev",
  authorize: async ({ email }, ctx) => {
    const { user } = await createAccount(ctx, {
      provider: "dev",
      account: { id: String(email) },
      profile: { email: String(email), name: String(email).split("@")[0] },
    });
    return { userId: user._id };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      profile: (google) => ({
        id: google.sub,
        name: google.name,
        email: google.email,
        domain: google.hd,
      }),
    }),
    ...(process.env.DEV_SIGN_IN ? [dev] : []),
  ],
  callbacks: {
    redirect: async ({ redirectTo }) => {
      if (new URL(redirectTo).hostname !== "127.0.0.1") throw new Error("Invalid redirect");
      return redirectTo;
    },
    createOrUpdateUser: async (ctx: MutationCtx, { existingUserId, profile }) => {
      const email = String(profile.email).toLowerCase();
      const domain = profile.domain as string | undefined;
      const invite = await ctx.db
        .query("invites")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (invite) await ctx.db.delete(invite._id);
      const user = existingUserId
        ? await ctx.db.get(existingUserId)
        : await ctx.db
            .query("users")
            .withIndex("email", (q) => q.eq("email", email))
            .first();
      if (user) {
        if (invite) await ctx.db.patch(user._id, { workspaceId: invite.workspaceId });
        return user._id;
      }
      const shared = domain
        ? await ctx.db
            .query("workspaces")
            .withIndex("domain", (q) => q.eq("domain", domain))
            .first()
        : null;
      const name = String(profile.name ?? email);
      const workspaceId =
        invite?.workspaceId ??
        shared?._id ??
        (await ctx.db.insert("workspaces", { name: domain ?? `${name}'s workspace`, domain }));
      const userId = await ctx.db.insert("users", { name, email, workspaceId });
      for (const [name, description] of BUCKETS)
        await ctx.db.insert("buckets", { userId, name, description });
      return userId;
    },
  },
});
