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
    // StyleX compiles `stylex.create` calls into atomic classes before Solid compiles the JSX.
    plugins: [stylex({ useCSSLayers: true }), solid()],
  },
});
