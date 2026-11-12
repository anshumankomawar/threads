import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { MutationCtx } from "./_generated/server";

const BUCKETS = [
  ["Messages that require action", "Someone is asking me to do, decide or answer something."],
  ["Messages to read", "Updates and conversations I only need to follow."],
];

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: ({ email, name }) => ({
        email: String(email).trim().toLowerCase(),
        name: String(name ?? email),
      }),
    }),
  ],
  callbacks: {
    createOrUpdateUser: async (ctx: MutationCtx, { existingUserId, profile }) => {
      const { email, name } = profile as { email: string; name: string };
      const invite = await ctx.db
        .query("invites")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (invite) await ctx.db.delete(invite._id);
      if (existingUserId) {
        if (invite) await ctx.db.patch(existingUserId, { workspaceId: invite.workspaceId });
        return existingUserId;
      }
      const workspaceId =
        invite?.workspaceId ?? (await ctx.db.insert("workspaces", { name: `${name}'s workspace` }));
      const userId = await ctx.db.insert("users", { name, email, workspaceId });
      for (const [name, description] of BUCKETS)
        await ctx.db.insert("buckets", { userId, name, description });
      return userId;
    },
  },
});
