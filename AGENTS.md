# Arc

A desktop app for threads: Electron, React 19 and Convex. `README.md` has how to run and check it.

## Before you change the interface

The interface is built from ui-sdk (`@ui-sdk/react`, with `@ui-sdk/core` under it). Don't hand-roll what it ships.

1. Follow the ui-sdk skill. It's in this repository at `.claude/skills/ui-sdk`, so Claude Code loads it on its own; any
   other agent should read `.claude/skills/ui-sdk/SKILL.md` first. `npx skills experimental_install` restores it from
   `skills-lock.json`.
2. Read `node_modules/@ui-sdk/react/docs/llms.txt`, then only the pages of the components you use, in
   `node_modules/@ui-sdk/react/docs/components/`.
3. To build a component ui-sdk doesn't ship, search `node_modules/@ui-sdk/react/docs/core.md` by heading (it's large)
   and read `rendering.md` next to it.

What's already in use, and where:

| For                                   | Component                                         | In                           |
| ------------------------------------- | ------------------------------------------------- | ---------------------------- |
| Reply and New Message, with @mentions | Token Input, Trigger Menu                         | `MessageBox.tsx`             |
| Mailboxes and the thread list         | Listbox                                           | `Sidebar.tsx`, `List.tsx`    |
| ⌘K, ⌘F and New Message                | Command, Dialog                                   | `Palette.tsx`                |
| Right-click menus                     | Menu                                              | `Menu.tsx`                   |
| Columns                               | Resizable                                         | `App.tsx`                    |
| Keys                                  | `useShortcut`                                     | `App.tsx`, `Thread.tsx`      |
| Theme                                 | `createPreference`                                | `state.ts`                   |
| Forms                                 | Field, Input, Checkbox, Segmented Control, Button | `Settings.tsx`, `SignIn.tsx` |

Styles are plain CSS in `src/renderer/src/app.css`, on class names and ui-sdk's `data-slot` and state attributes
(`data-selected`, `data-highlighted`, `data-open`).

## Rules

- Write the least code that does the job, and no comments in code.
- No backwards compatibility: change what's there instead of adding a second way beside it.
- Nothing in the interface shows "…" or "...": not in placeholders or labels, and not from truncation (text that
  doesn't fit is clipped).
- Every Convex function is made with `query` and `mutation` from `convex/functions.ts`, never the ones in
  `_generated/server`: they sign the caller in and give you `ctx.me`. Read and write only inside `ctx.me.workspaceId`,
  and reach a thread through `membership`. The only exceptions are the three in `convex/workspace.ts` that someone
  with no workspace yet must reach (`me`, `create`, `join`); they call `signedIn` themselves.
- An action has no `ctx.me`: it reaches data only through those queries and mutations (`convex/search.ts`).
- A message's delivery lives in `post` in `convex/threads.ts`. Change it with its tests, in `tests/`.
- After adding or removing a dependency, restart `bun run dev`: a running dev server keeps its old bundle of them.
