import { ElectronAPI } from "@electron-toolkit/preload";

// Who you're signed in as (src/main/signIn.ts): the person, and the token the sync API takes for them.
type SignedIn = { personId: string; email: string; token: string; workspace: string };

declare global {
  interface Window {
    electron: ElectronAPI;
    // Better Auth's Electron bridges (src/preload/index.ts).
    requestAuth: (options?: { provider?: string }) => Promise<void>;
    authenticate: (data: { token: string }) => Promise<void>;
    onAuthenticated: (callback: (user: unknown) => void) => () => void;
    onAuthError: (callback: (error: unknown) => void) => () => void;
    signOut: () => Promise<void>;
    // Who you're signed in as, and signing in with an emailed code (src/main/signIn.ts).
    threads: {
      signedIn: () => Promise<SignedIn | null>;
      // The data source the main process signs in against; choosing another restarts the app.
      source: () => Promise<"cloudflare" | "local" | "sample">;
      useSource: (source: string) => Promise<void>;
      sendCode: (email: string) => Promise<{ error?: string }>;
      verifyCode: (email: string, code: string) => Promise<{ error?: string }>;
    };
  }
}
