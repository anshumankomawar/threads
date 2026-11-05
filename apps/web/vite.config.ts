import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// The sign-in page. In development it proxies the API's sign-in routes (`/api/auth/*`, `/auth/*`) so its cookie is
// same-origin and Google redirects back here. THREADS_API points it at another local API.
const api = process.env.THREADS_API ?? "http://127.0.0.1:3030";

export default defineConfig({
  plugins: lazyPlugins(() => [react()]),
  server: {
    port: 5180,
    strictPort: true,
    proxy: { "/api": api, "/auth": api },
  },
});
