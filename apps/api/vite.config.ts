import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

// Hono on Workers: the Cloudflare plugin runs the Worker and its Durable Objects in the Workers runtime locally. Tests
// run the routes over in-memory engines, so they leave it out and need no Cloudflare account.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [cloudflare()],
  // The desktop app expects the local API here.
  server: { host: "127.0.0.1", port: 3030, strictPort: true },
}));
