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

// Sets the CSS tokens (`data-theme` on the root) and the window's vibrancy (the main process's `set-theme`), and
// remembers the choice.
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.electron?.ipcRenderer.send("set-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembered; it still applies for this session.
  }
}
