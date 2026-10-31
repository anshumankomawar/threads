# Branch Rule

All AI-written code must go on the `prototype` branch. Before writing or editing code, check the current branch with `git branch --show-current`; if it is not `prototype`, switch with `git switch prototype` (create it with `git switch -c prototype` if missing). Never commit AI-written code to `main` or any other branch.

# Running the App

- `apps/api`: local Hono API on `http://127.0.0.1:3030` (IPv4 only; the desktop app connects there). Start it with `vp run api#dev`. Data lives in memory and resets on restart. Requests pick a workspace with the `X-Workspace` header: `local` (the default: Anshu, Arjun and KK, no threads) or `sample` (the demo team and threads from `packages/model`, addressed to the OS username).
- `apps/desktop`: Electron app. Start it with `vp run desktop#dev`. It waits and retries until the API answers.
- `vp run dev` at the root starts both.
- `packages/model`: the thread model and sample data, shared by both apps.
- electron-vite only hot-reloads the renderer. After changing `src/main` or `src/preload`, restart the desktop dev task. Sample-data shape changes need a renderer reload (⌘R), and API changes need an API restart.
- Test the API with `vp test` in `apps/api`.
- In the app, ⌘K opens the command palette (it also switches Local and Sample data), ⌘N starts a thread, ⌘U switches who you view the app as, and ⌘+ / ⌘- / ⌘0 zoom the main content.

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
