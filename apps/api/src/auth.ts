import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { emailOTP } from "better-auth/plugins";
import { electron } from "@better-auth/electron";

// Signing in, with Better Auth: Google, or a one-time code sent to your email. Its users and sessions live in D1
// (`AUTH_DB`), apart from the workspaces. Only invited emails get in (`INVITES`), each as one Person; a signed-in
// session is then traded for the Threads session token the sync API already takes (`POST /auth/token` in worker.ts).
// The desktop app signs in from its main process (Better Auth's Electron plugin): email codes directly, and Google in
// the browser, which comes back to this API and then to the app on a `com.threads.arc://` link (`SIGNED_IN_PAGE`).

const DEV_SECRET = "threads-local-development-secret-not-for-production";
// The local API. The browser must use exactly this origin all the way through Google and back (its cookies are this
// host's), so it's 127.0.0.1, as the API serves, never localhost.
const LOCAL_ORIGIN = "http://127.0.0.1:3030";
// The desktop app's link scheme, which signing in with Google sends you back to it on.
const APP_SCHEME = "com.threads.arc";

// The Person an email signs in as, if `INVITES` (`email=personId` pairs, separated by commas) invites it.
export function personFor(invites: string, email: string): string | undefined {
  for (const pair of invites.split(",")) {
    const [invited, personId] = pair.split("=").map((part) => part.trim());
    if (invited?.toLowerCase() === email.trim().toLowerCase()) return personId || undefined;
  }
}

// Sends a sign-in code: by email through Resend when there's a key, else to the Worker's log, which is only allowed
// locally (no API_TOKEN), so a hosted API never silently drops codes.
async function sendCode(env: Env, email: string, otp: string): Promise<void> {
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
function authOptions(env: Env) {
  const origin = env.BETTER_AUTH_URL || LOCAL_ORIGIN;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;
  return {
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET || (env.API_TOKEN ? undefined : DEV_SECRET),
    baseURL: origin,
    // The desktop app signs in through the browser and comes back on a `com.threads.arc://` link (Better Auth's Electron plugin).
    trustedOrigins: [origin, `${APP_SCHEME}:/`],
    socialProviders: google === undefined ? {} : { google },
    plugins: [
      electron(),
      emailOTP({
        // Uninvited emails are told nothing, so the form can't be used to find out who's invited.
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in" || personFor(env.INVITES, email) === undefined) return;
          await sendCode(env, email, otp);
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // The invite list decides who gets an account, however they sign in.
          before: async (user) => {
            if (personFor(env.INVITES, user.email) === undefined)
              throw new APIError("FORBIDDEN", { message: "This email isn't invited to Threads" });
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

// Better Auth's tables are made in D1 the first time this isolate signs anyone in, so it never starts without them.
let migrated: Promise<void> | undefined;

export async function createAuth(env: Env) {
  const options = authOptions(env);
  migrated ??= getMigrations(options).then(({ runMigrations }) => runMigrations());
  await migrated.catch((error: unknown) => {
    migrated = undefined;
    throw error;
  });
  return betterAuth(options);
}

// Where the browser lands after signing in with Google for the desktop app (the plugin sends it to `/`). Signing in left
// a one-time code in a cookie (`better-auth.electron`); the page takes it and opens the app on a `com.threads.arc://` link,
// showing the code to paste in case the link doesn't open it. Plain HTML, so the API serves it without a build.
export const SIGNED_IN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Arc</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: Canvas; color: CanvasText; }
  main { width: min(380px, calc(100vw - 32px)); padding: 28px; border: 1px solid #8884; border-radius: 12px; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  p { margin: 8px 0; }
  .muted { opacity: 0.7; }
  code { display: block; padding: 10px 12px; border: 1px solid #8884; border-radius: 8px; word-break: break-all;
    user-select: all; }
</style>
</head>
<body>
<main>
  <h1>Arc</h1>
  <p id="status">Nothing to do here. You can close this tab.</p>
  <div id="fallback" hidden>
    <p class="muted">If Arc didn't open, paste this code into it:</p>
    <code id="code"></code>
  </div>
</main>
<script>
  const status = document.getElementById("status");
  const error = new URLSearchParams(location.search).get("error");
  const cookie = document.cookie.split("; ").find((c) => c.startsWith("better-auth.electron="));
  const code = cookie && cookie.slice(cookie.indexOf("=") + 1);
  if (error) status.textContent = "Signing in didn't work: " + error.replaceAll("_", " ");
  else if (code) {
    document.cookie = "better-auth.electron=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";
    status.textContent = "Signed in. Returning to Arc…";
    document.getElementById("code").textContent = code;
    document.getElementById("fallback").hidden = false;
    location.replace("${APP_SCHEME}://auth/callback#token=" + code);
  }
</script>
</body>
</html>`;
