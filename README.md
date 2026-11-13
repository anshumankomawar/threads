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
bunx convex env set ANTHROPIC_API_KEY ...  # sorts new threads into buckets; without it they stay in Sorting
```

People sign in with an email and a password. A new account gets its own workspace, unless someone has invited that
email (Settings, People), in which case it joins theirs.

## Check it

```sh
bun run test     # the delivery rules, against an in-memory Convex
bun run build    # types, then the app
```

## Where things are

- `convex/` is the backend: the schema, `threads.ts` (what a message does), `workspace.ts`, `auth.ts`, `ai.ts`.
- `src/main` is the Electron window. `src/renderer` is the interface, built from ui-sdk components (see `AGENTS.md`).
