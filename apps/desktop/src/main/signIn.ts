import { electronClient } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { app, ipcMain, webContents } from "electron";

// Signing the app in, with Better Auth's Electron plugin, all from this main process:
// - An emailed code: the window asks for it and passes it here, and this signs in with the API directly.
// - Google: the browser opens straight at Google, comes back to the API, and the API's page opens the app on a
//   `com.threads.arc://` link with a one-time code (or shows the code to paste), which this trades for a session.
// The session stays here, encrypted with the OS keychain (`safeStorage`) before it's written to disk; the window only
// ever gets the Threads token for the person you are (`threads:signed-in`).

// The data source, and its API, where Better Auth runs. The client is made once, before the app is ready, so choosing
// another source restarts the app. Each source keeps its own session.
const RESTART_DEV = 75;
const HOSTED_URL = import.meta.env.VITE_API_URL;
const SOURCE_FILE = join(app.getPath("userData"), "source");
const source = ((): string => {
  try {
    return readFileSync(SOURCE_FILE, "utf8");
  } catch {
    return HOSTED_URL ? "cloudflare" : "local";
  }
})();
// The API's BETTER_AUTH_URL must name this very origin, since Google's round trip depends on it.
const API_URL = source === "cloudflare" && HOSTED_URL ? HOSTED_URL : "http://127.0.0.1:3030";

const auth = createAuthClient({
  baseURL: API_URL,
  plugins: [
    emailOTPClient(),
    electronClient({
      // Google sign-in goes straight to Google; this page is only where the browser lands afterwards.
      signInURL: `${API_URL}/`,
      protocol: { scheme: "com.threads.arc" },
      storage: storage(),
      storagePrefix: `better-auth:${source}`,
      // Threads shows its own avatars.
      userImageProxy: { enabled: false },
    }),
  ],
});

// Who you're signed in as, for the window: the person and the token the sync API takes, or null when you're not signed
// in (or the API can't be reached).
export type SignedIn = { personId: string; email: string; token: string; workspace: string };

// An answer for the window: done, or why not.
type Outcome = { error?: string };

async function signedIn(): Promise<SignedIn | null> {
  const cookie = auth.getCookie();
  if (!cookie) return null;
  try {
    const response = await fetch(`${API_URL}/auth/token`, { method: "POST", headers: { cookie } });
    return response.ok ? ((await response.json()) as SignedIn) : null;
  } catch {
    return null;
  }
}

// Tells every window you're signed in, as the plugin does after Google, so it reloads as you.
const announce = (): void => {
  for (const contents of webContents.getAllWebContents())
    contents.send("better-auth:authenticated", null);
};

// Must run before the app is ready: it registers the `com.threads.arc://` link and the window's sign-in bridges. Not the
// plugin's content security policy, which would keep the window from reaching the API.
export function setupSignIn(): void {
  auth.setupMain({ scheme: true, bridges: true });
  ipcMain.handle("threads:signed-in", signedIn);
  ipcMain.handle("threads:source", () => source);
  ipcMain.handle("threads:use-source", (_event, next: string) => {
    writeFileSync(SOURCE_FILE, next);
    // In development the dev server stops with the app, so `dev` in package.json starts both again on this code.
    if (is.dev) return app.exit(RESTART_DEV);
    app.relaunch();
    app.exit(0);
  });
  // Emails a sign-in code. An uninvited email gets nothing, and is told nothing different.
  ipcMain.handle("threads:send-code", async (_event, email: string): Promise<Outcome> => {
    const { error } = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    return error ? { error: error.message ?? "Couldn't send a code" } : {};
  });
  ipcMain.handle(
    "threads:verify-code",
    async (_event, email: string, code: string): Promise<Outcome> => {
      const { error } = await auth.signIn.emailOtp({ email, otp: code });
      if (error) return { error: error.message ?? "That code didn't work" };
      announce();
      return {};
    },
  );
}
