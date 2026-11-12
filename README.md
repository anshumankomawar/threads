# Arc

Threads, as a desktop app: Electron, React and Convex.

## Run it

```sh
bun install
bun run convex   # the backend, watching convex/
bun run dev      # the app
```

The first `bun run convex` creates a deployment and writes `.env.local`. Then set it up once:

```sh
bunx @convex-dev/auth                      # signing keys and SITE_URL
bunx convex env set AUTH_GOOGLE_ID ...     # Google OAuth client, with the redirect
bunx convex env set AUTH_GOOGLE_SECRET ... #   https://<deployment>.convex.site/api/auth/callback/google
bunx convex env set ANTHROPIC_API_KEY ...  # sorts new threads into buckets; without it they stay in Sorting
bunx convex env set DEV_SIGN_IN 1          # development only: sign in as any email, without Google
```

## Check it

```sh
bun run test     # the delivery rules, against an in-memory Convex
bun run build    # types, then the app
```

## Where things are

- `convex/` is the backend: the schema, `threads.ts` (what a message does), `workspace.ts`, `auth.ts`, `ai.ts`.
- `src/main` is the Electron window and browser sign-in. `src/renderer` is the interface.
