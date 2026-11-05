import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

// The Cloudflare plugin runs the Worker and its Durable Objects in the Workers runtime locally. Tests run the rules and
// sorting over in-memory servers, so they leave it out and need no Cloudflare account.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [cloudflare()],
  oxc: { decorator: { legacy: true } },
  // The desktop app expects the local API here.
  server: { host: "127.0.0.1", port: 3030, strictPort: true },
}));
