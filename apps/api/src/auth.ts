import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { emailOTP } from "better-auth/plugins";

// Signing in, with Better Auth: Google, or a one-time code sent to your email. Its users and sessions live in D1
// (`AUTH_DB`), apart from the workspaces. Only invited emails get in (`INVITES`), each as one Person; a signed-in
// session is then traded for the Threads session token the sync API already takes (`POST /auth/token` in worker.ts).

// What signing in needs from the Worker's environment. Secrets locally come from apps/api/.dev.vars.
export type AuthEnv = {
  AUTH_DB: D1Database;
  // Signs Better Auth's cookies. Locally there's a fixed one, so it works without setup; the hosted API needs its own.
  BETTER_AUTH_SECRET?: string;
  // Where the sign-in page is served from (its origin), which Google redirects back to.
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Sends sign-in codes. Without it, codes are only logged, which is enough locally.
  RESEND_API_KEY?: string;
  // Who may sign in, and as whom: `email=personId` pairs, separated by commas.
  INVITES?: string;
  // Set on the hosted API only.
  API_TOKEN?: string;
};

const DEV_SECRET = "threads-local-development-secret-not-for-production";
const LOCAL_ORIGIN = "http://localhost:5180";

// The invite list: each invited email (lower case) and the Person it signs in as.
export function parseInvites(text: string | undefined): Map<string, string> {
  const invites = new Map<string, string>();
  for (const pair of (text ?? "").split(",")) {
    const [email, personId] = pair.split("=").map((part) => part.trim());
    if (email && personId) invites.set(email.toLowerCase(), personId);
  }
  return invites;
}

// The Person an email signs in as, if it's invited.
export const personFor = (env: AuthEnv, email: string): string | undefined =>
  parseInvites(env.INVITES).get(email.trim().toLowerCase());

// Sends a sign-in code: by email through Resend when there's a key, else to the Worker's log, which is only allowed
// locally (no API_TOKEN), so a hosted API never silently drops codes.
async function sendCode(env: AuthEnv, email: string, otp: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.API_TOKEN)
      throw new APIError("INTERNAL_SERVER_ERROR", { message: "Email isn't set up" });
    console.log(`Sign-in code for ${email}: ${otp}`);
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Resend's shared test sender; send from your own domain once it's verified there.
      from: "Threads <onboarding@resend.dev>",
      to: email,
      subject: "Your Threads sign-in code",
      text: `Your sign-in code is ${otp}. It expires in 5 minutes.`,
    }),
  });
  if (!response.ok)
    throw new APIError("BAD_GATEWAY", { message: `Sending the code failed (${response.status})` });
}

// Better Auth's settings for one request (the D1 binding exists only while handling one).
function authOptions(env: AuthEnv) {
  const origin = env.BETTER_AUTH_URL || LOCAL_ORIGIN;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;
  return {
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET || (env.API_TOKEN ? undefined : DEV_SECRET),
    baseURL: origin,
    trustedOrigins: [origin],
    socialProviders: google === undefined ? {} : { google },
    plugins: [
      emailOTP({
        // Uninvited emails are told nothing, so the form can't be used to find out who's invited.
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in" || personFor(env, email) === undefined) return;
          await sendCode(env, email, otp);
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // The invite list decides who gets an account, however they sign in.
          before: async (user) => {
            if (personFor(env, user.email) === undefined)
              throw new APIError("FORBIDDEN", { message: "This email isn't invited to Threads" });
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

// Better Auth's tables, made in D1 the first time this isolate signs anyone in. Adding a plugin adds its tables.
let migrated: Promise<void> | undefined;

function ensureTables(options: BetterAuthOptions): Promise<void> {
  migrated ??= getMigrations(options)
    .then(({ runMigrations }) => runMigrations())
    .catch((error: unknown) => {
      migrated = undefined;
      throw error;
    });
  return migrated;
}

// Better Auth for one request, once its tables exist (made first, so it never starts on a database without them).
export async function createAuth(env: AuthEnv) {
  const options = authOptions(env);
  await ensureTables(options);
  return betterAuth(options);
}
