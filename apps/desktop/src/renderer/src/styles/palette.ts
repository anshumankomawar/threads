import * as stylex from "@stylexjs/stylex";
import { paletteSectionMarker } from "./markers.stylex";
import { colors, fontSizes, layers, radii, shadows } from "./tokens.stylex";

// The palette shell, shared by every *Palette.tsx, ComposePanel and OrganizationPrompt. Apply with
// `{...stylex.attrs(palette.row, selected() && palette.rowSelected)}`. Each palette's own extras (CommandPalette's tabs,
// ViewAsPalette's tick, BlockedPalette's chip, NewThreadPalette's "Asked by" side controls, ComposePanel's `.compose`)
// stay with that component. No element here needs a plain hook class: nothing selects them from JS.
//
// Palettes (command palette, new thread palette): 560px wide, centered, 120px from the top. Sized after Delta's search
// palette.
export const palette = stylex.create({
  // .palette-overlay — a light dim behind palettes; clicking it closes them.
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: layers.overlay,
    backgroundColor: colors.overlay,
  },
  // .palette
  panel: {
    position: "absolute",
    top: "120px",
    left: "50%",
    display: "flex",
    flexDirection: "column",
    width: "560px",
    maxHeight: "474px",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    borderRadius: radii.panel,
    backgroundColor: colors.panel,
    boxShadow: shadows.panel,
    transform: "translateX(-50%)",
  },
  // .palette-input-row
  inputRow: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    height: "37px",
    padding: "0 10px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.panelBorder,
  },
  // .palette-input (and its ::placeholder)
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderStyle: "none",
    color: {
      default: colors.textPrimary,
      "::placeholder": colors.textTertiary,
    },
    font: "inherit",
    fontSize: fontSizes.input,
    backgroundColor: "transparent",
    outline: "none",
  },
  // .palette-results
  results: {
    minHeight: 0,
    paddingTop: "4px",
    overflowY: "auto",
  },
  // .palette-section — sections are 4px-padded groups split by a 1px divider. Apply with the marker, so a section
  // after another gets its divider: `{...stylex.attrs(palette.section, paletteSectionMarker)}`.
  section: {
    display: "flex",
    flexDirection: "column",
    paddingBottom: "4px",
    borderTopWidth: "1px",
    borderTopStyle: {
      default: null,
      [stylex.when.siblingBefore(":is(*)", paletteSectionMarker)]: "solid",
    },
    borderTopColor: colors.panelBorder,
  },
  // .palette-section-label
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    height: "28px",
    paddingLeft: "10px",
    color: colors.textSecondary,
    fontSize: fontSizes.label,
  },
  // .palette-row; add rowSelected when data-selected was "true" (the keyboard's row) and rowDisabled when data-disabled
  // was "true" (a continue row that isn't ready). Keep aria-selected as it is.
  row: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "27.5px",
    margin: "0 4px",
    padding: "0 8px 1px 6px",
    borderRadius: radii.control,
    color: colors.textPrimary,
    cursor: "pointer",
  },
  // .palette-row[data-selected="true"]
  rowSelected: {
    backgroundColor: colors.panelSelected,
  },
  // .palette-row[data-disabled="true"]
  rowDisabled: {
    color: colors.textTertiary,
    cursor: "default",
  },
  // .palette-row-label
  rowLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // .palette-row-shortcut
  rowShortcut: {
    flexShrink: 0,
    color: colors.textSecondary,
    wordSpacing: "2.5px",
  },

  // New thread palette: which step you're on, what you're assigning, and a disabled continue row.
  // .palette-step
  step: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
  },
  // .palette-summary — always on a section label, after it: `stylex.attrs(palette.sectionLabel, palette.summary)`.
  summary: {
    gap: "4px",
    paddingRight: "14px",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  // .palette-summary-title
  summaryTitle: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.textPrimary,
    textOverflow: "ellipsis",
  },
  // .palette-summary-count
  summaryCount: {
    marginLeft: "auto",
    color: colors.textTertiary,
  },
  // .palette-empty
  empty: {
    padding: "4px 10px",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
  },

  // Invite step: a checkbox per person, the running count, and a continue row under the list.
  // .palette-check; add checkChecked when data-checked was "true".
  check: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: colors.iconTertiary,
    borderRadius: radii.control,
  },
  // .palette-check[data-checked="true"]
  checkChecked: {
    borderColor: colors.accent,
    color: colors.onAccent,
    backgroundColor: colors.accent,
  },
  // .palette-continue — always on a row, after it: `stylex.attrs(palette.row, palette.continue)`.
  continue: {
    marginTop: "4px",
    color: colors.textSecondary,
  },
});
