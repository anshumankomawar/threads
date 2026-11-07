# Branch Rule

All AI-written code must go on the `prototype` branch. Before writing or editing code, check the current branch with `git branch --show-current`; if it is not `prototype`, switch with `git switch prototype` (create it with `git switch -c prototype` if missing). Never commit AI-written code to `main` or any other branch.

# Running the App

- **Architecture.** Threads runs on its own Linear-style sync engine, built exactly to `docs/sync-engine-v1-spec.md`. **Before changing models, the API, or anything in `packages/protocol`, `packages/sync` or `packages/server`, read the spec and `docs/architecture.md`**, and keep the latter up to date when the architecture changes. Product builders define models with the decorators (`packages/models/src/models.ts`), put server rules in `packages/models/src/rules.ts`, and write UI that reads models and calls `save()`.
- `apps/api` locally: `vp run api#dev` runs the Worker on `http://127.0.0.1:3030` (IPv4 only). Its Workers AI binding (inbox sorting) calls the real Threads account even locally, so it needs `cf` logged in to that account; `THREADS_LOCAL_AI=off vp run api#dev` leaves AI out, and inbox items wait unsorted. Data persists in `apps/api/.cloudflare/state`; a new workspace seeds itself, and a local workspace whose data was written under other models starts over by itself, so there's no reset to do after a model change (deleting `v3/do` with the API stopped still starts over on demand).
- `apps/api` hosted: https://threads-api.threads-app.workers.dev on the Threads Cloudflare account. Deploy with `vp run api#deploy` (`cf deploy`). Use the `cf` CLI, not Wrangler. The `API_TOKEN` secret is the admin session. After changing `cloudflare.config.ts`, regenerate types with `vpx cf workers types` in `apps/api`.
- `apps/desktop`: Electron app. Start it with `vp run desktop#dev`. Its data source is picked in ⌘K and remembered: Cloudflare (the shared workspace on the hosted API), Local (the local Worker's `local` workspace) or Sample (its demo workspace). Cloudflare is offered, and is the default, when `apps/desktop/.env.local` sets `VITE_API_URL` (gitignored). Local and Cloudflare open on a sign-in screen (Google only, as in Linear) and each keeps its own session; Sample is viewed as anyone (⌘U). Switching source restarts the app, since the main process signs in against that source's API. Closing the window only hides it; the app keeps running until ⌘Q.
- **Future plans.** Parked product ideas live in `docs/future-plans.md`.
- `vp run dev` at the root starts both.
- **Signing in** (desktop): the sign-in screen, Google only. Continue with Google opens your browser and comes back to the app on a `com.threads.arc://` link (paste the code the browser shows if it doesn't). It needs only the API running; only invited emails get in. It needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from a Google Cloud OAuth client (Web application) whose redirect URI is exactly `http://127.0.0.1:3030/api/auth/callback/google` (127.0.0.1, not localhost). See "Signing in" in `docs/architecture.md`.
- `apps/api/.dev.vars` (gitignored) holds the API's secrets locally. List them all, blank where unused, or the API warns about each missing one; a blank value counts as unset. Keep `API_TOKEN` blank so the local API stays open:

  ```
  API_TOKEN=
  INVITES=you@example.com=arjun,teammate@example.com=anshu
  BETTER_AUTH_SECRET=
  BETTER_AUTH_URL=
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  ```

- electron-vite only hot-reloads the renderer. After changing `src/main` or `src/preload`, restart the desktop dev task. API changes need an API restart.
- Test with `vp test` in `packages/sync` (unit tests), `packages/testing` (the deterministic simulation), `packages/server`, `packages/models` and `apps/api`.
- In the app, ⌘K opens the command menu (everything: the open thread's actions, every mailbox, people, threads, creating things, settings), ⌘N starts a thread, ⌘⇧N writes one as a message the model drafts, ⌘U switches who you view the app as, ⌘[ / ⌘] (or the mouse's back and forward buttons) go back and forward through the pages you've opened, and ⌘+ / ⌘- / ⌘0 zoom the main content. In the inbox: J/K (or ↑/↓ in the list) next and previous, ⌘E done, R reply.

# Building UI

- **Everything is reachable from ⌘K.** Whenever you add or change something you can do or go to in the desktop app (a button, a menu item, a page, a setting, a hotkey, a new kind of record), add it to or update it in the command registry, `apps/desktop/src/renderer/src/commands.ts`, in the same change. An action with a hotkey goes through `hotkey(...)` there so ⌘K runs exactly what the key does and shows its keys; one with choices of its own gets a `page`; a place to go is a `place(...)`; and anything that only makes sense in a context (the open thread) is listed only then. If a feature can't sensibly be in ⌘K, say why in its comment.

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
