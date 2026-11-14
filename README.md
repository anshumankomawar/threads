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

To have new threads sorted into buckets (without it they never reach Buckets, only All Threads):

```sh
bunx convex env set ANTHROPIC_API_KEY ...
```

The same key lets Search ask a model for the threads a question is about (Ask Arc). To have Search also find messages by
meaning, give it a Voyage key; each new message is then embedded as it's posted:

```sh
bunx convex env set VOYAGE_API_KEY ...
```

People sign in with Google. A new account has no workspace: it creates one, or joins one through the invite link
a member copied from Settings. Google returns the app its sign-in through `http://127.0.0.1:47201`, which the app
listens on only while you sign in.

## The website

`src/web` is the site at arcteams.chat: the landing page, Google sign-in, and `/join/<code>`, where an invite link
leads and where signing in joins the workspace. It shares the app's components, styles and backend.

```sh
bun run web                                         # http://localhost:5173
bunx convex env set SITE_URL http://localhost:5173  # once: where invite links point, and where Google may return to
```

`bun run deploy:web` builds the site against the shared deployment and publishes it to Cloudflare with the `cf` CLI
(`cloudflare.config.ts` names it and sends every path to `index.html`).

## The shared deployment

`bun run dev` talks to your own dev deployment, where you can break things. The built app talks to the one everyone
shares (`.env.production`), so that is where real conversations live:

```sh
bun run build && bunx electron-vite preview   # the app, on the shared deployment
bunx convex deploy                            # the backend in convex/, to the shared deployment
```

Deploy the backend when `convex/` changes on the `convex` branch. Its keys are set with `bunx convex env set --prod`.

## Check it

```sh
bun run test     # the delivery rules, against an in-memory Convex
bun run build    # types, then the app
```

## Where things are

- `convex/` is the backend: the schema, `threads.ts` (what a message does), `workspace.ts`, `auth.ts`, `ai.ts`
  (sorting into buckets) and `search.ts` (search by meaning, Ask Arc).
- `src/main` is the Electron window. `src/renderer` is the interface, built from ui-sdk components (see `AGENTS.md`).
