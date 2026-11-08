import { defineConfig } from "cf/config";

// Arc's landing page as a Worker with static assets only: the prerendered page and its fonts and field, nothing to
// run. Deploy with `vp run deploy` (`cf deploy`); it serves from the account's workers.dev subdomain until there's a
// domain to point at it.
export default defineConfig({
  // The Threads Cloudflare account.
  accountId: "80308317b4a59eb5d4880895142af795",
  worker: {
    name: "arc-landing",
    compatibilityDate: "2026-10-19",
    workersDev: true,
    assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "404-page" },
  },
});
