import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/worker.ts" with { type: "cf-worker" };

// Read when the config loads, in Node; the Worker's own types leave Node out.
declare const process: { env: Record<string, string | undefined> };

// The threads API as a Worker: a Hono app in front of one SQLite Durable Object per workspace.
// Local dev (mode "development") also serves the sample workspace; the deployed Worker serves only the shared one.
export default defineConfig(({ mode }) => ({
  // The Threads Cloudflare account.
  accountId: "80308317b4a59eb5d4880895142af795",
  worker: {
    name: "threads-api",
    compatibilityDate: "2026-10-19",
    // Better Auth's Electron plugin fetches the API's own address, which otherwise never reaches this Worker.
    compatibilityFlags: ["global_fetch_strictly_public"],
    entrypoint,
    observability: { enabled: true },
    exports: {
      Workspace: exports.durableObject({ storage: "sqlite" }),
    },
    // The Worker reaches its own Workspace objects through ctx.exports, so they need no binding.
    env: {
      // Bearer token the hosted API requires; leave it unset locally to keep the API open.
      API_TOKEN: bindings.secret(),
      SAMPLE_WORKSPACE: bindings.text(mode === "development" ? "on" : "off"),
      // Signing in (src/auth.ts): Better Auth's users and sessions, and its settings. Locally the secrets come from
      // apps/api/.dev.vars; they have local defaults or are optional.
      AUTH_DB: bindings.d1({ name: "threads-auth" }),
      BETTER_AUTH_SECRET: bindings.secret(),
      // This API's own origin, which Google redirects back to (http://127.0.0.1:3030 locally, its default).
      BETTER_AUTH_URL: bindings.secret(),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      // Workers AI sorts inboxes into buckets. It always runs on Cloudflare, in local dev too, within the account's
      // free daily allocation, so local dev needs a login on the Threads account. Without access, `THREADS_LOCAL_AI=off`
      // leaves it out: everything else works, and threads wait under "Sorting".
      ...(process.env.THREADS_LOCAL_AI === "off"
        ? {}
        : { AI: bindings.ai({ dev: { remote: true } }) }),
    },
  },
}));
