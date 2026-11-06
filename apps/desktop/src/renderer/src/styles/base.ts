import * as stylex from "@stylexjs/stylex";
import { colors, radii } from "./tokens.stylex";

// What many styles share, composed where they're used: `sx(base.bare, styles.link)`. Put it first, so a style after it
// can change what it sets.
export const base = stylex.create({
  // A button with none of the browser's own look.
  bare: {
    padding: 0,
    borderStyle: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    backgroundColor: "transparent",
  },
  // One line, cut off at the edge.
  clip: { minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" },
  ellipsis: { minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  hover: { backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary } },
  // Quiet text that brightens under the pointer.
  dim: { color: { default: colors.textTertiary, ":hover": colors.textPrimary } },
  // A floating panel: menus, palettes, toasts.
  panel: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
  },
});
