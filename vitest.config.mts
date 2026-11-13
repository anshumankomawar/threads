import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    env: { CONVEX_CLOUD_URL: "https://test.convex.cloud" },
  },
});
