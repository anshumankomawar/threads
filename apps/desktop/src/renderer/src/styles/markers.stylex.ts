import * as stylex from "@stylexjs/stylex";

// Markers for rules that depend on a sibling before them (StyleX has no `+`): palette sections and thread header lines.
export const paletteSectionMarker = stylex.defineMarker();
export const threadLineMarker = stylex.defineMarker();

// Each sidebar tab's measured label width, set on the label by the sidebar so the chosen tab grows to fit it.
export const tabLabel = stylex.defineVars({
  "--label-width": "auto",
});
