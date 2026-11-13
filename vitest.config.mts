import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

const wasm: Plugin = {
  name: "wasm-module",
  enforce: "pre",
  resolveId: (source, importer) =>
    source.endsWith(".wasm") && importer ? `\0${resolve(dirname(importer), source)}.js` : null,
  load(id) {
    if (!id.startsWith("\0") || !id.endsWith(".wasm.js")) return;
    const bytes = readFileSync(id.slice(1, -3)).toString("base64");
    return `export default new WebAssembly.Module(Uint8Array.from(atob("${bytes}"), (c) => c.charCodeAt(0)));`;
  },
};

export default defineConfig({
  plugins: [wasm],
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    env: { CONVEX_CLOUD_URL: "https://test.convex.cloud" },
    server: { deps: { inline: [/password-hash-wasm/] } },
  },
});
