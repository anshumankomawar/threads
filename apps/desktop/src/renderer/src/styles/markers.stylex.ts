import * as stylex from "@stylexjs/stylex";

// Markers for rules that depend on a sibling before them (StyleX has no `+`): palette sections and thread header lines.
export const paletteSectionMarker = stylex.defineMarker();
export const threadLineMarker = stylex.defineMarker();
