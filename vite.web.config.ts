import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  envDir: "../..",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
