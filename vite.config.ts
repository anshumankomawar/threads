import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    plugins: ["oxc", "typescript", "unicorn", "react"],
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
        // Solid, not React: a ref is a plain `let el!: T` the compiler assigns, a component body runs once, and the React
        // Compiler's rules (refs, purity, immutability) don't apply.
        files: ["apps/desktop/**/*.tsx"],
        rules: {
          "no-unassigned-vars": "off",
          "react/refs": "off",
          "react/purity": "off",
          "react/immutability": "off",
        },
      },
      {
        // The desktop app is Solid, where these React rules don't apply.
        files: ["apps/web/**/*.tsx", "packages/ui/**/*.tsx"],
        rules: {
          "react/rules-of-hooks": "error",
          "react/exhaustive-deps": "warn",
          "react/jsx-key": "error",
          "react/only-export-components": ["warn", { allowConstantExport: true }],
        },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
