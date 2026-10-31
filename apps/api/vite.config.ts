import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

// Hono on Workers: the Cloudflare plugin runs the Worker and its Durable Objects in the Workers runtime locally.
export default defineConfig({
  plugins: [cloudflare()],
  // The desktop app expects the local API here.
  server: { host: "127.0.0.1", port: 3030, strictPort: true },
});
