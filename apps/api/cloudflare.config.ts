import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/worker.ts" with { type: "cf-worker" };

// The threads API as a Worker: a Hono app in front of one SQLite Durable Object per workspace.
export default defineConfig({
  // The Threads Cloudflare account.
  accountId: "80308317b4a59eb5d4880895142af795",
  worker: {
    name: "threads-api",
    compatibilityDate: "2026-10-19",
    entrypoint,
    observability: { enabled: true },
    exports: {
      Workspace: exports.durableObject({ storage: "sqlite" }),
    },
    // The Worker reaches its own Workspace objects through ctx.exports, so they need no binding.
    env: {
      // Bearer token the hosted API requires; leave it unset locally to keep the API open.
      API_TOKEN: bindings.secret(),
    },
  },
});
