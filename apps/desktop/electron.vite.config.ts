import { resolve } from "path";
import { defineConfig } from "electron-vite";
import stylex from "@stylexjs/unplugin/vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  // The main process signs in against the hosted API too, so it reads the same VITE_API_URL.
  main: { envPrefix: ["VITE_"] },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    // Models use legacy decorators.
    oxc: { decorator: { legacy: true } },
    // StyleX compiles `stylex.create` calls into atomic classes before Solid compiles the JSX. No performance
    // tracks: on by default in development, they record every scope that renders, with its element, and never let go
    // (a window open for a day held gigabytes of rows and avatars long gone).
    plugins: [stylex({ useCSSLayers: true }), solid({ performanceTracks: false })],
  },
});
