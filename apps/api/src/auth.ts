import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { electron } from "@better-auth/electron";

// Signing in, with Better Auth, through Google. Its users and sessions live in D1 (`AUTH_DB`), beside the directory
// of workspaces (directory.ts). Anyone with a Google account can sign in; a signed-in session is then traded for the
// Threads session token the sync API takes, for one of their workspaces (`POST /auth/token` in worker.ts).
// The desktop app signs in from its main process (Better Auth's Electron plugin), with Google in the browser, which comes back to this API and then to the app on a `com.threads.arc://` link (`SIGNED_IN_PAGE`).

const DEV_SECRET = "threads-local-development-secret-not-for-production";
// The local API. The browser must use exactly this origin all the way through Google and back (its cookies are this
// host's), so it's 127.0.0.1, as the API serves, never localhost.
const LOCAL_ORIGIN = "http://127.0.0.1:3030";
// The desktop app's link scheme, which signing in with Google sends you back to it on.
const APP_SCHEME = "com.threads.arc";

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
    plugins: [electron()],
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
  /* The desktop app's sign-in screen: its colours, type and pill buttons. */
  :root {
    color-scheme: light dark;
    --ground: oklch(0.985 0 0);
    --text: oklch(0.21 0 0);
    --muted: color-mix(in srgb, var(--text) 55%, transparent);
    --fill: color-mix(in srgb, var(--text) 4%, transparent);
    --fill-hover: color-mix(in srgb, var(--text) 8%, transparent);
    --stroke: color-mix(in srgb, var(--text) 10%, transparent);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: oklch(0.191 0 0);
      --text: oklch(0.955 0 0);
      --muted: color-mix(in srgb, var(--text) 60%, transparent);
      --fill: color-mix(in srgb, var(--text) 5%, transparent);
      --fill-hover: color-mix(in srgb, var(--text) 9%, transparent);
      --stroke: color-mix(in srgb, var(--text) 8%, transparent);
    }
  }
  body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: var(--ground); color: var(--text); }
  main { display: flex; flex-direction: column; align-items: center; width: min(320px, calc(100vw - 32px)); text-align: center; }
  h1 { margin: 0 0 8px; font-size: 19px; font-weight: 500; }
  p { margin: 0; color: var(--muted); text-wrap: balance; }
  #signed-in { width: 100%; margin-top: 24px; }
  #signed-in[hidden] { display: none; }
  a { display: flex; height: 44px; align-items: center; justify-content: center; border-radius: 22px; background: var(--text);
    color: var(--ground); font-weight: 500; text-decoration: none; }
  a:hover { opacity: 0.85; }
  #signed-in p { margin: 24px 0 8px; font-size: 13px; }
  .code { display: flex; height: 44px; box-sizing: border-box; align-items: center; gap: 8px; padding: 0 6px 0 18px;
    border: 1px solid var(--stroke); border-radius: 22px; background: var(--fill); }
  code { flex: 1; overflow: hidden; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: left;
    text-overflow: ellipsis; white-space: nowrap; user-select: all; }
  button { height: 32px; padding: 0 14px; border: 0; border-radius: 16px; background: var(--fill-hover); color: inherit;
    font: inherit; font-size: 13px; cursor: pointer; }
  button:hover { background: var(--stroke); }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--muted); outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1 id="title">Arc</h1>
  <p id="status" role="status">Log in from the Arc app. You can close this tab.</p>
  <div id="signed-in" hidden>
    <a id="open">Open Arc</a>
    <p>Or paste this code into Arc</p>
    <div class="code">
      <code id="code"></code>
      <button id="copy" type="button">Copy</button>
    </div>
  </div>
</main>
<script>
  const title = document.getElementById("title");
  const status = document.getElementById("status");
  const error = new URLSearchParams(location.search).get("error");
  const cookie = document.cookie.split("; ").find((c) => c.startsWith("better-auth.electron="));
  const code = cookie && cookie.slice(cookie.indexOf("=") + 1);
  if (error) {
    title.textContent = "Couldn't log you in";
    status.textContent = "Go back to Arc and try again. (" + error.replaceAll("_", " ") + ")";
  } else if (code) {
    document.cookie = "better-auth.electron=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";
    const link = "${APP_SCHEME}://auth/callback#token=" + code;
    title.textContent = "You're logged in";
    status.textContent = "Returning to Arc…";
    document.getElementById("open").href = link;
    document.getElementById("code").textContent = code;
    document.getElementById("signed-in").hidden = false;
    const copy = document.getElementById("copy");
    copy.onclick = () => navigator.clipboard.writeText(code).then(() => { copy.textContent = "Copied"; });
    location.replace(link);
  }
</script>
</body>
</html>`;
