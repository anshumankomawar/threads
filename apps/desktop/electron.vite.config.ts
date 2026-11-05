import { resolve } from "path";
import { defineConfig } from "electron-vite";
import stylex from "@stylexjs/unplugin/vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    // StyleX compiles `stylex.create` calls into atomic classes before Solid compiles the JSX.
    plugins: [stylex({ useCSSLayers: true }), solid()],
  },
});
