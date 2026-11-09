import * as stylex from "@stylexjs/stylex";

// Markers for rules that depend on a sibling before them (StyleX has no `+`): palette sections and thread header lines.
export const paletteSectionMarker = stylex.defineMarker();
export const threadLineMarker = stylex.defineMarker();
// On Peek's body: what it shows (a thread, a page) sits closer to its edges, the same on either side.
export const peekMarker = stylex.defineMarker();
// On the timeline's toolbar: its chips and New stand as tall as the tabs beside them.
export const toolbarMarker = stylex.defineMarker();

// Each sidebar tab's measured label width, set on the label by the sidebar so the chosen tab grows to fit it.
export const tabLabel = stylex.defineVars({
  "--label-width": "auto",
});
