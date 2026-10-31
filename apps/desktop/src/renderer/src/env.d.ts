/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Where the API runs; defaults to the local Worker. Set it (and the token) to use the hosted API.
  readonly VITE_API_URL?: string;
  readonly VITE_API_TOKEN?: string;
}
