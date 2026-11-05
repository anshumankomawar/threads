# Branch Rule

All AI-written code must go on the `prototype` branch. Before writing or editing code, check the current branch with `git branch --show-current`; if it is not `prototype`, switch with `git switch prototype` (create it with `git switch -c prototype` if missing). Never commit AI-written code to `main` or any other branch.

# Running the App

- **Architecture.** Data syncs like Linear's sync engine: clients send transactions, one Durable Object per workspace executes them and numbers every change with a sync id, and clients apply the resulting delta packets in order. The engine itself is the `packages/sync` package, a black box that knows nothing about threads (read its `README.md`); Threads plugs into it with its schema and predictions (`packages/model/src/sync.ts`) and its rules (`apps/api/src/engine.ts`). **Before changing models, the API, `packages/sync`, or anything in `apps/desktop/src/renderer/src/sync`, read `docs/architecture.md` and follow its invariants and its recipes for adding fields, models, transactions and side effects.** Keep that doc up to date when the architecture changes.
- `apps/api` locally: `vp run api#dev` runs the Worker in the Workers runtime on `http://127.0.0.1:3030` (IPv4 only). Its Workers AI binding (inbox sorting) calls the real Threads account even locally, so it needs `cf` logged in to that account, or the API won't start. Without access, `THREADS_LOCAL_AI=off vp run dev` leaves AI out: everything else works, and threads wait under "Sorting". `vp test` needs no account. Data persists in `apps/api/.cloudflare/state`. To start a workspace over, `POST /sync/reset` with `X-Workspace` (and the bearer token on the hosted API): it deletes everything and reseeds; connected clients notice the server is behind their cache and rebuild.
- `apps/api` hosted: https://threads-api.threads-app.workers.dev on the Threads Cloudflare account. Deploy with `vp run api#deploy` (`cf deploy`). Use the `cf` CLI, not Wrangler. A running workspace Durable Object keeps its old code for up to 5 minutes after a deploy; check the bootstrap's `schemaHash` to see when the new version is serving. The hosted API requires a bearer token (`?token=` on the socket): the `API_TOKEN` secret itself is an admin session, and the app trades it for the session token of whoever it views as (`POST /auth/session`), so the server acts and filters as that person. Locally the API is open, and `X-User` says who you are. After changing `cloudflare.config.ts`, regenerate types with `vpx cf workers types` in `apps/api`.
- `apps/desktop`: Electron app. Start it with `vp run desktop#dev`. It waits and retries until the API answers. Its data source is picked in the command palette and remembered: Cloudflare (the shared workspace on the hosted API), Local (the local Worker's `local` workspace) or Sample (the local Worker's demo team). Cloudflare is offered, and is the default, when `apps/desktop/.env.local` sets `VITE_API_URL` and `VITE_API_TOKEN` (gitignored; never commit the token). The top bar shows the current source.
- **Future plans.** Parked product ideas, with the research already done, are in `docs/future-plans.md` Read the matching entry before building one, and move it into `docs/architecture.md` once it's built.
- `vp run dev` at the root starts both.
- `apps/web`: the sign-in page (Google, or a code sent to your email). Start it with `vp run web#dev` on `http://localhost:5180`, with the API running; it proxies the API's sign-in routes. Only invited emails get in: put `INVITES=you@example.com=arjun` (comma-separated `email=personId` pairs) in `apps/api/.dev.vars` (gitignored). Locally, sign-in codes are printed in the API's log. Google sign-in also needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` there, from a Google Cloud OAuth client whose redirect URI is `http://localhost:5180/api/auth/callback/google`. See "Signing in" in `docs/architecture.md`.
- `apps/api/.dev.vars` locally: the API warns about every secret that isn't listed, so list them all, blank where unused. A blank value counts as unset; keep `API_TOKEN` blank so the local API stays open (`X-User`), and leave `RESEND_API_KEY` blank so codes print in the API's log:

  ```
  API_TOKEN=
  INVITES=you@example.com=arjun,teammate@example.com=anshu
  BETTER_AUTH_SECRET=
  BETTER_AUTH_URL=
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  RESEND_API_KEY=
  ```

- `packages/model`: the thread model and sample data, shared by both apps.
- electron-vite only hot-reloads the renderer. After changing `src/main` or `src/preload`, restart the desktop dev task. Sample-data shape changes need a renderer reload (⌘R), and API changes need an API restart.
- Test the sync engine with `vp test` in `packages/sync`, the API with `vp test` in `apps/api` (Threads' rules over in-memory engines via `createApp`), and the desktop app's sync client, plan and org logic with `vp test` in `apps/desktop`.
- In the app, ⌘K (or ⌘⇧F) opens the command palette (it also opens your profile and the org, groups and labels, switches the data source, and switches between dark and light mode), ⌘N starts a thread, ⌘U switches who you view the app as, and ⌘+ / ⌘- / ⌘0 zoom the main content.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
