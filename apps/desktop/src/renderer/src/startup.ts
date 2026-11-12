// What the window settles before anything else: where its data comes from (kept by the main process, which signs in
// against that API), who you're signed in as, and the theme. The sign-in screen needs only this, never the store.
import { createSignal } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { lightTheme } from "./styles/tokens.stylex";

export type Source = "cloudflare" | "local" | "sample";
const HOSTED_URL = import.meta.env.VITE_API_URL;
export const SOURCES: Partial<Record<Source, string>> = {
  ...(HOSTED_URL ? { cloudflare: "Cloudflare" } : {}),
  local: "Local",
  sample: "Sample",
};

export function saved<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}
export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// The main process keeps the source and signs in against its API, so choosing another restarts the app.
export const useSource = (next: Source): Promise<void> => window.threads.useSource(next);
export const source = await window.threads.source();
export const otherSources = (Object.keys(SOURCES) as Source[]).filter((s) => s !== source);
export const server = {
  url: source === "cloudflare" ? HOSTED_URL! : "http://127.0.0.1:3030",
  workspace: source === "cloudflare" ? "local" : source,
};

// Local and Cloudflare are the team's workspace, which you sign in to; Sample is a demo you view as anyone (⌘U).
export const account = source === "sample" ? null : await window.threads.signedIn();
export const needsSignIn = source !== "sample" && account === null;
// Signing in or out reloads as whoever you are now.
window.onAuthenticated(() => location.reload());
export async function signOut(): Promise<void> {
  await window.signOut();
  location.reload();
}

// Slack is the light theme with an aubergine sidebar (Sidebar.tsx puts `slackSidebar` on it).
export type Theme = "dark" | "light" | "slack";
const [chosen, setChosen] = createSignal<Theme>(saved("theme", "light"));
export const theme = chosen;
const LIGHT = (stylex.attrs(lightTheme).class ?? "").split(" ").filter(Boolean);
export function applyTheme(next: Theme): void {
  setChosen(next);
  save("theme", next);
  const light = next !== "dark";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  for (const name of LIGHT) document.documentElement.classList.toggle(name, light);
  window.electron?.ipcRenderer.send("set-theme", light ? "light" : "dark");
}
applyTheme(theme());
