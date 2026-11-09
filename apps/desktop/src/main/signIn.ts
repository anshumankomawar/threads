import { electronClient } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import { createAuthClient } from "better-auth/client";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { app, ipcMain } from "electron";

// Signing the app in, with Better Auth's Electron plugin, all from this main process:
// - Google: the browser opens straight at Google, comes back to the API, and the API's page opens the app on a
//   `com.threads.arc://` link with a one-time code (or shows the code to paste), which this trades for a session.
// The session stays here, encrypted with the OS keychain (`safeStorage`) before it's written to disk; the window only
// ever gets the Threads token for the person you are (`threads:signed-in`).

// The data source, and its API, where Better Auth runs. The client is made once, before the app is ready, so choosing
// another source restarts the app. Each source keeps its own session.
const RESTART_DEV = 75;
const HOSTED_URL = import.meta.env.VITE_API_URL;
// A second copy run beside the usual one keeps its own (see index.ts); this is read on import, before index.ts runs.
const DATA_DIR = (is.dev && process.env["THREADS_SIDE_BY_SIDE"]) || app.getPath("userData");
const SOURCE_FILE = join(DATA_DIR, "source");
const source = ((): string => {
  try {
    return readFileSync(SOURCE_FILE, "utf8");
  } catch {
    return HOSTED_URL ? "cloudflare" : "local";
  }
})();
// The API's BETTER_AUTH_URL must name this very origin, since Google's round trip depends on it.
const API_URL =
  source === "cloudflare" && HOSTED_URL
    ? HOSTED_URL
    : (process.env.VITE_LOCAL_API_URL ?? "http://127.0.0.1:3030");

const auth = createAuthClient({
  baseURL: API_URL,
  plugins: [
    electronClient({
      // Google sign-in goes straight to Google; this page is only where the browser lands afterwards.
      signInURL: `${API_URL}/`,
      protocol: { scheme: "com.threads.arc" },
      storage: storage({ cwd: DATA_DIR }),
      storagePrefix: `better-auth:${source}`,
      // Threads shows its own avatars.
      userImageProxy: { enabled: false },
    }),
  ],
});

// Who you're signed in as, in `workspace` (or your first), for the window: null when you're not signed in (or the API
// can't be reached), and `{ onboarding: true }` when you are but have no workspace yet.
async function signedIn(workspace?: string): Promise<unknown> {
  const cookie = auth.getCookie();
  if (!cookie) return null;
  try {
    const response = await fetch(`${API_URL}/auth/token`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    });
    if (response.status === 409) return { onboarding: true };
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// The API's routes for choosing, making and inviting to workspaces (apps/api), as whoever's signed in: the session
// stays here, so the window asks through this. Only those routes, so it can't reach anything else as you.
const CALLABLE = /^\/(onboarding|workspaces(\/[\w-]+\/(join|invites))?)$/;
async function call(
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!CALLABLE.test(path)) return { ok: false, status: 404, body: null };
  const cookie = auth.getCookie() ?? "";
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

// Must run before the app is ready: it registers the `com.threads.arc://` link and the window's sign-in bridges. Not the
// plugin's content security policy, which would keep the window from reaching the API.
// `claimLink` is false for a second copy run beside the usual one, which leaves the link to it.
export function setupSignIn({ claimLink = true } = {}): void {
  auth.setupMain({ scheme: claimLink, bridges: true });
  ipcMain.handle("threads:signed-in", (_event, workspace?: string) => signedIn(workspace));
  ipcMain.handle("threads:call", (_event, path: string, body?: unknown) => call(path, body));
  ipcMain.handle("threads:source", () => source);
  ipcMain.handle("threads:use-source", (_event, next: string) => {
    writeFileSync(SOURCE_FILE, next);
    // In development the dev server stops with the app, so `dev` in package.json starts both again on this code.
    if (is.dev) return app.exit(RESTART_DEV);
    app.relaunch();
    app.exit(0);
  });
}
