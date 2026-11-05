/// <reference types="vite/client" />

interface ImportMetaEnv {
  // The hosted API; with it set, the app offers the Cloudflare source, which you sign in to.
  readonly VITE_API_URL?: string;
}
