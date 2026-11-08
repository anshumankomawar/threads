import { cloudflare } from "@cloudflare/vite-plugin";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
import { prerender } from "./scripts/prerender";

// `vp dev` renders the page in the browser (src/index.tsx). `vp build` renders it once on the server instead
// (src/entry-server.tsx, through scripts/prerender.ts): Solid without `ssr` compiles what Vite loads on the server to
// plain HTML with no hydration keys, so the page ships as one HTML file with its CSS inlined and no JavaScript. The
// Cloudflare plugin makes that build the Worker's static assets (cloudflare.config.ts), for `cf deploy`.
export default defineConfig({
  plugins: lazyPlugins(() => [
    stylex({ useCSSLayers: true }),
    solid(),
    prerender(),
    ...(process.env.ARC_PRERENDERING ? [] : [cloudflare()]),
  ]),
});
