import build from "@hono/vite-build/node";
import devServer from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import { defineConfig } from "vite-plus";

// Hono on Vite: the dev server runs the app on Node, and the build bundles it into a Node server.
export default defineConfig({
  plugins: [
    build({ entry: "src/index.ts" }),
    devServer({ adapter: nodeAdapter, entry: "src/index.ts" }),
  ],
});
