# Styles

The renderer's styles are StyleX (`@stylexjs/stylex` 0.19, compiled by `@stylexjs/unplugin/vite` with CSS layers). Each
component keeps its own `stylex.create` block; what several components share lives here. The only plain CSS is
`assets/global.css` (the reset, body, scrollbars, `#root` and the Tiptap editor's content), in the lowest layer. Comments
that name an old class (`// .palette-row`) say which rule of the old `main.css` a style replaced.

## Files

| File                | What it is                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.stylex.ts`  | `colors` (with `lightTheme`), `sidebarSpace`, `contentZoom` (`--content-zoom`), `layers` (z-indexes), `radii`, `fontSizes`, `shadows`. Use these, never `var(--…)`.                                                   |
| `markers.stylex.ts` | `paletteSectionMarker`, `threadLineMarker`: for the two rules that depend on a sibling before them.                                                                                                                   |
| `sx.ts`             | `sx(...styles)`: StyleX styles as a class string.                                                                                                                                                                     |
| `palette.ts`        | `palette`: the palette shell (overlay, panel, input row, results, sections, rows, summary, step, empty, check, continue).                                                                                             |
| `page.ts`           | `page`: list pages (page, title, summary, items and their parts), group page toolbar/actions/filters/empty/heading, profile facts, `.org-title`/`.org-summary`/`.profile-heading`.                                    |
| `thread.ts`         | `thread`: view, scroll, doc, block, header, byline, title, description, avatar, body, meta, author, text.                                                                                                             |
| `controls.ts`       | `chip` + `chipTone`, `menu` (also `.context-menu`, `.chip-menu`), `topbar`, `toast`, `status` + `statusDot` (and the unread dot), `link` (person, mention, thread link), `button` (`.compose-button`), `editorClass`. |

Every export has a comment naming the old class it replaces and how to apply its states. Anything used by one
component only stays in that component.

## Applying styles in Solid

- Spread `stylex.attrs` (not `stylex.props`, which is React's `className`):
  `<div {...stylex.attrs(palette.row, selected() && palette.rowSelected)} />`.
- Or use `sx` for just the class: `class={sx(styles.row, active() && styles.rowActive)}`. Beside a hook class:
  `class={[sx(thread.view), "thread-view"]}`. `sx` drops `style`, so use `attrs` for dynamic styles.
- **Later wins.** States go after the base; a role goes after a generic style: `stylex.attrs(link.person, thread.author)`
  replaces `.thread-author.person-link`.
- **States become conditional styles**: `data-selected="true"` → `selected() && palette.rowSelected`. Variants keyed by a
  value index a create object: `tone && chipTone[tone]`, `s !== "open" && statusDot[s]`. Keep the aria- attributes; data-
  attributes that only existed for CSS can go.
- **Attributes set by plain DOM code** (not Solid) can't drive a condition, so use an attribute pseudo in the value:
  `maskImage: { default: null, ":is([data-overflowing])": "…" }`. Write it as `:is([…])`. A bare `"[…]"` key compiles
  but breaks the types.
- **Pseudo-classes, pseudo-elements and media queries** go inside a value:
  `color: { default: colors.textPrimary, ":hover": colors.accent, "@media (prefers-reduced-motion: reduce)": … }`,
  `"::placeholder"` the same way. Use `stylex.keyframes` for animations, as in `toast.toast`.
- **Parent or sibling state**: export a separate style the component applies (e.g. `page.itemsInGroupPage`,
  `link.threadInByline`), or use a marker with `stylex.when.ancestor/descendant/siblingBefore(":is(*)", marker)`.
  Markers must be defined in a `.stylex.ts` file. Put the marker on the element being watched:
  `stylex.attrs(palette.section, paletteSectionMarker)`.
- **Children StyleX can't reach** (`.thread-byline svg`, `.compose-button kbd`, `.toast > .identicon`) get their own
  style, passed to the child: `<Icon {...stylex.attrs(thread.bylineIcon)} />`, `<Identicon class={sx(toast.avatar)} />`.
- **Dynamic values** go through dynamic styles, not string-built inline styles:
  `const dyn = stylex.create({ width: (px: number) => ({ width: px }) })`, then `{...stylex.attrs(dyn.width(w()))}`.
- **Light theme**: the `colors` tokens switch with `lightTheme` (applied to the root by `applyTheme`), so
  `:root[data-theme="light"] .x` rules need nothing more. None of the shared rules had any other light override.

## Pitfalls

- **Use longhands for borders.** `border`, `borderTop`, `borderBottom` and the like are dropped silently: no error,
  no CSS. Write `borderWidth` + `borderStyle` + `borderColor` (or `borderBottomWidth`…), and `borderStyle: "none"` for
  `border: none`. `margin`, `padding`, `gap`, `flex`, `font: "inherit"`, `inset`, `outline` and `overflow` do work.
  Use `backgroundColor`, not `background`.
- **z-index takes numbers**: `layers` holds numbers for that reason.
- **Unlayered CSS beats StyleX.** StyleX's rules are in CSS layers, so any plain CSS left outside a layer wins over
  them whatever its specificity. Keep `global.css` inside `@layer reset`, and add no other stylesheets.
- Check computed styles, not just screenshots (dump `getComputedStyle` for every element before and after).

## Hook classes that must stay

These elements keep a plain class beside their StyleX class, because code selects them:

- `chip-menu`, `context-menu`, `thread-menu`: App's keys check `document.querySelector(".chip-menu, .context-menu, .thread-menu")`.
- `thread-view` (and `thread-panes` on App's split container), `thread-reply-editor` on the reply's editor: App focuses
  the reply with `.thread-panes > .thread-view .thread-reply-editor`.
- `thread-overscroll`: ThreadView's click handler checks `classList.contains("thread-overscroll")`.
- `sidebar-tab-label`: Sidebar measures labels with `querySelectorAll(".sidebar-tab-label")`.

Markup that isn't JSX takes class strings: Tiptap's `renderHTML` in `mentionNode.ts` and `threadLinkNode.ts` takes
`editorClass.mention` / `editorClass.threadLink` (from `controls.ts`) in place of `"mention"` / `"thread-link"`. The nodes
are found by their data attributes, so they need no hook class. The reply editor's root gets its class through
`editorProps.attributes.class`: `` `${sx(thread.text, …)} thread-reply-editor` ``. `slashCommands.ts` renders no markup.

## What stays global

A small global stylesheet, in `@layer reset` (declared first in `index.html`, so it sits under StyleX's layers),
keeps what StyleX can't reach:

- `:root` / `:root[data-theme="light"]`: `color-scheme: dark` / `light` (form controls and scrollbars follow it), and
  `--scrollbar-thumb` until the scrollbar rule takes a token. Main.css's other `--…` tokens go once nothing reads them.
- `*, *::before, *::after`: `box-sizing: border-box; margin: 0`.
- `body`: height, `overflow: hidden`, `user-select: none`, text colour, the glass background, font family, size (12px),
  line height (16px), font smoothing.
- `body *`: `scrollbar-width: thin; scrollbar-color: … transparent`.
- `#root`: `display: flex; height: 100%`.
- Tiptap/ProseMirror editor content, which ProseMirror creates itself: `.thread-reply-editor p` (`margin: 0`) and
  `.thread-reply-editor p.is-editor-empty:first-child::before` (the placeholder: `content: attr(data-placeholder)`,
  floated, tertiary colour, no pointer events).

Tiptap also injects its own `.ProseMirror` stylesheet, unlayered, so it beats StyleX on the editor root. That's only
editor basics (`white-space`, `word-wrap`, caret), but keep it in mind before styling the editor root's other properties.
