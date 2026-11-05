import * as stylex from "@stylexjs/stylex";

// Markers for the rules that depend on a neighbour (StyleX has no `+` or descendant selectors). Put the marker on the
// element being looked at, alongside its own styles: `{...stylex.attrs(palette.section, paletteSectionMarker)}`.

// On every palette section: a section after another gets a divider (main.css's `.palette-section + .palette-section`).
export const paletteSectionMarker = stylex.defineMarker();

// On a thread header's author line and byline: a title after either sits closer to it (main.css's
// `.thread-header .thread-meta + .thread-title, .thread-header .thread-byline + .thread-title`).
export const threadLineMarker = stylex.defineMarker();
