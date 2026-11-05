import * as stylex from "@stylexjs/stylex";
import { lightTheme } from "./styles/tokens.stylex";

// Dark or light, switched from ⌘K and remembered on this device. Dark until you pick.
export type Theme = "dark" | "light";

const THEME_KEY = "theme";

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

// The StyleX theme's class on the root, for light.
const LIGHT_CLASS = stylex.attrs(lightTheme).class ?? "";

// Sets the theme (the StyleX theme's class for StyleX's tokens, and `data-theme` for global.css's colour scheme) and the
// window's vibrancy (the main process's `set-theme`), and remembers the choice.
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  for (const name of LIGHT_CLASS.split(" ").filter(Boolean))
    document.documentElement.classList.toggle(name, theme === "light");
  window.electron?.ipcRenderer.send("set-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembered; it still applies for this session.
  }
}
