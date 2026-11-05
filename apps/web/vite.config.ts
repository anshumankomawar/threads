import { defineConfig } from "vite-plus";

// Read when the config loads, in Node.
declare const process: { env: Record<string, string | undefined> };

// The sign-in page. In development it proxies the API's sign-in routes (`/api/auth/*`, `/auth/*`) so its cookie is
// same-origin and Google redirects back here. Its own port, since the desktop app's renderer has 5173. THREADS_API
// points it at another local API.
const api = process.env.THREADS_API ?? "http://127.0.0.1:3030";

export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
    proxy: { "/api": api, "/auth": api },
  },
});
