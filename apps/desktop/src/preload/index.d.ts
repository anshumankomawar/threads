import { ElectronAPI } from "@electron-toolkit/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
    // Better Auth's Electron bridges (src/preload/index.ts).
    requestAuth: (options?: { provider?: string }) => Promise<void>;
    authenticate: (data: { token: string }) => Promise<void>;
    onAuthenticated: (callback: (user: unknown) => void) => () => void;
    signOut: () => Promise<void>;
    // Who you're signed in as: the person, and the token the sync API takes for them, in a workspace of yours
    // (src/main/signIn.ts); or that you have none yet.
    threads: {
      signedIn: (workspace?: string) => Promise<
        | {
            personId: string;
            email: string;
            token: string;
            workspace: string;
            workspaces: { id: string; name: string }[];
          }
        | { onboarding: true }
        | null
      >;
      // The API's workspace routes, as you (GET without a body, POST with one).
      call: (
        path: string,
        body?: unknown,
      ) => Promise<{ ok: boolean; status: number; body: unknown }>;
      // The data source the main process signs in against; choosing another restarts the app.
      source: () => Promise<"cloudflare" | "local" | "sample">;
      useSource: (source: string) => Promise<void>;
    };
  }
}
