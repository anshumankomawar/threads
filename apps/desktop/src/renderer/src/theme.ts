import * as stylex from "@stylexjs/stylex";
import { lightTheme } from "./styles/tokens.stylex";

export type Theme = "dark" | "light";

const THEME_KEY = "theme";

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

const LIGHT_CLASS = stylex.attrs(lightTheme).class ?? "";

// StyleX's light theme class, `data-theme` for global.css, the window's vibrancy, and remembering it.
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
