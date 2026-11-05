import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    plugins: ["oxc", "typescript", "unicorn"],
    categories: {
      correctness: "error",
    },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    ignorePatterns: ["**/dist", "**/out"],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/no-explicit-any": "error",
    },
    overrides: [
      {
        // Solid: a ref is a plain `let el!: T` the compiler assigns.
        files: ["apps/desktop/**/*.tsx"],
        rules: { "no-unassigned-vars": "off" },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
