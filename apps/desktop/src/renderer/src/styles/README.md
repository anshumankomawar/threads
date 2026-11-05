# Styles

StyleX (`@stylexjs/stylex`, built by `@stylexjs/unplugin/vite` with CSS layers). Each component keeps its own
`stylex.create`; what several share lives here: tokens and the light theme (`tokens.stylex.ts`), markers, `sx`, and
shared styles (`controls.ts`, `page.ts`, `palette.ts`, `thread.ts`). The only plain CSS is `assets/global.css`, in
`@layer reset` under StyleX's layers.

- Apply with `class={sx(styles.row, active() && styles.rowActive)}`; later styles win. Use `stylex.attrs` for dynamic
  styles, which set an inline `style`.
- Shorthands like `border`/`borderTop` are dropped silently: use longhands. z-index takes numbers.
- Attribute conditions set by plain DOM code: `":is([data-x])"` inside a value.
- Unlayered CSS beats StyleX, so add no other stylesheets.
- Hook classes stay where code selects them: `chip-menu`, `context-menu`, `thread-menu`, `thread-view`,
  `thread-panes`, `thread-reply-editor`, `thread-overscroll`, `inbox-row`.
