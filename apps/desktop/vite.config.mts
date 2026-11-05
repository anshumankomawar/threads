import { createRequire } from "node:module";
import { defineConfig } from "vite-plus";

const require = createRequire(import.meta.url);

// For tests only; the app itself builds from electron.vite.config.ts. Tests run in Node, where `solid-js` resolves to
// its server build, which never runs effects; the browser build is the one the app uses.
export default defineConfig({
  resolve: {
    alias: {
      "solid-js": require.resolve("solid-js").replace(/server\.js$/, "solid.dev.js"),
    },
  },
});
