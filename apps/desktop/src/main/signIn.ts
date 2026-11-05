import { electronClient } from "@better-auth/electron/client";
import { storage } from "@better-auth/electron/storage";
import { createAuthClient } from "better-auth/client";
import { ipcMain } from "electron";

// Signing the app in, with Better Auth's Electron plugin: "Sign in" opens the sign-in page (apps/web) in the browser,
// which sends you back on a `com.threads.arc://` link with a one-time code (or shows the code to paste), and the code is traded
// for a session. The session stays here in the main process, encrypted with the OS keychain (`safeStorage`) before
// it's written to disk; the window only ever gets the Threads token for the person you are (`threads:signed-in`).

// The sign-in page, which also proxies the API's sign-in routes. THREADS_SIGN_IN_URL points elsewhere.
const SIGN_IN_URL = process.env.THREADS_SIGN_IN_URL ?? "http://localhost:5180";

const auth = createAuthClient({
  baseURL: SIGN_IN_URL,
  plugins: [
    electronClient({
      signInURL: SIGN_IN_URL,
      protocol: { scheme: "com.threads.arc" },
      storage: storage(),
      // Threads shows its own avatars.
      userImageProxy: { enabled: false },
    }),
  ],
});

// Who you're signed in as, for the window: the person and the token the sync API takes, or null when you're not signed
// in (or the sign-in page can't be reached).
export type SignedIn = { personId: string; email: string; token: string; workspace: string };

// Must run before the app is ready: it registers the `com.threads.arc://` link and the window's sign-in bridges. Not the
// plugin's content security policy, which would keep the window from reaching the API.
export function setupSignIn(): void {
  auth.setupMain({ scheme: true, bridges: true });
  ipcMain.handle("threads:signed-in", async (): Promise<SignedIn | null> => {
    const cookie = auth.getCookie();
    if (!cookie) return null;
    try {
      const response = await fetch(`${SIGN_IN_URL}/auth/token`, {
        method: "POST",
        headers: { cookie },
      });
      return response.ok ? ((await response.json()) as SignedIn) : null;
    } catch {
      return null;
    }
  });
}
