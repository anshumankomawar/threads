import * as stylex from "@stylexjs/stylex";
import { colors, contentZoom } from "../styles/tokens.stylex";

// What the profile pages share: your profile and the org (ProfileView), settings laid out like it (SettingsView), and
// the avatar header someone else's profile has too (PersonView).
export const profile = stylex.create({
  // .org — your profile and the org, laid out where a thread's page would be. The same margins as a thread: the title
  // where a thread's title sits (the thread's padding plus its header's). The main content zooms on its own (⌘+, ⌘-,
  // ⌘0); the sidebar, top bar and palettes keep their size.
  page: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    padding: "calc(13.75px + 4px) 15px 48px 52px",
    overflowY: "auto",
    zoom: contentZoom["--content-zoom"],
  },
  // .profile — the avatar beside the name and details, then a few facts.
  header: {
    display: "flex",
    gap: "14px",
    alignItems: "center",
  },
  // .org-rename — a quiet text button in a summary line.
  textButton: {
    padding: 0,
    borderStyle: "none",
    color: {
      default: "inherit",
      ":hover": colors.textPrimary,
    },
    font: "inherit",
    textAlign: "left",
    textDecoration: {
      default: null,
      ":hover": "underline",
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },
});
