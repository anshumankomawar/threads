# Styles

StyleX (`@stylexjs/stylex`, built by `@stylexjs/unplugin/vite` with CSS layers). Each component keeps its own
`stylex.create`; what several share lives here: tokens and the light theme (`tokens.stylex.ts`), markers and the tab
label width (`markers.stylex.ts`), `sx`, and shared styles (`controls.ts`, `page.ts`, `palette.ts`, `thread.ts`, and `zotero.ts`, the Zotero 7 panes' toolbars,
buttons and tree rows, whose colours are the `z*` tokens and whose sizes are `zotero` in `tokens.stylex.ts`). The
only plain CSS is `assets/global.css`, in `@layer reset` under StyleX's layers.

- Apply with `class={sx(styles.row, active() && styles.rowActive)}`; later styles win. Use `stylex.attrs` for dynamic
  styles, which set an inline `style`.
- Shorthands like `border`/`borderTop` are dropped silently: use longhands. z-index takes numbers.
- Attribute conditions set by plain DOM code: `":is([data-x])"` inside a value.
- Menus are popovers and palettes are `<dialog>`s: global.css only removes the browser's look; a popover's `display`
  is set only under `:popover-open` (`menu.popover`), or StyleX's `display` would show it while closed.
- Unlayered CSS beats StyleX, so add no other stylesheets.
- Hook class: `reply` (the reply editor, which ProseMirror fills; global.css styles its paragraphs and placeholder).
