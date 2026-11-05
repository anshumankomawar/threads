import { createRequire } from "node:module";
import { defineConfig } from "vite-plus";

// Tests run Solid's browser build: its server build never runs effects.
const solid = createRequire(import.meta.url)
  .resolve("solid-js")
  .replace(/server\.js$/, "solid.dev.js");

export default defineConfig({
  oxc: { decorator: { legacy: true } },
  resolve: { alias: { "solid-js": solid } },
});
