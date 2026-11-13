# Arc

Threads, as a desktop app: Electron, React and Convex.

## Run it

```sh
bun install
bun run convex   # the backend, watching convex/
bun run dev      # the app
```

The first `bun run convex` creates a deployment and writes `.env.local`. Convex Auth signs its sessions with the
deployment's own key. Signing in with Google needs a Google Cloud OAuth client (Web application) whose redirect URI is
the deployment's site URL (`VITE_CONVEX_SITE_URL` in `.env.local`) followed by `/oauth/google/callback`, and its id and
secret on the deployment; the deployment won't start without them:

```sh
bunx convex env set AUTH_GOOGLE_CLIENT_ID ...
bunx convex env set AUTH_GOOGLE_CLIENT_SECRET ...
```

To have new threads sorted into buckets (without it they stay in Sorting):

```sh
bunx convex env set ANTHROPIC_API_KEY ...
```

The same key lets Search answer a question when nothing matches (Ask Arc). To have Search also find messages by
meaning, give it a Voyage key; each new message is then embedded as it's posted:

```sh
bunx convex env set VOYAGE_API_KEY ...
```

People sign in with Google. A new account gets its own workspace, unless someone has
invited that email (Settings, People), in which case it joins theirs. Google returns the app its sign-in through
`http://127.0.0.1:47201`, which the app listens on only while you sign in.

## Check it

```sh
bun run test     # the delivery rules, against an in-memory Convex
bun run build    # types, then the app
```

## Where things are

- `convex/` is the backend: the schema, `threads.ts` (what a message does), `workspace.ts`, `auth.ts`, `ai.ts`.
- `src/main` is the Electron window. `src/renderer` is the interface, built from ui-sdk components (see `AGENTS.md`).
