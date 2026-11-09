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

// Local and Cloudflare are your workspaces, which you sign in to; Sample is a demo you view as anyone (⌘U). Signed in,
// you're in the workspace you were last in (or your first); with none yet, you make or join one (Welcome.tsx).
const workspaceKey = `workspace:${source}`;
const signedIn =
  source === "sample" ? null : await window.threads.signedIn(saved(workspaceKey, undefined));
export const account = signedIn !== null && "token" in signedIn ? signedIn : null;
export const needsSignIn = source !== "sample" && signedIn === null;
// Choosing a workspace: you have none yet, or you asked to make or join another (`chooseWorkspace`).
export const needsWorkspace =
  (signedIn !== null && "onboarding" in signedIn) ||
  (account !== null && location.hash === "#workspaces");
if (account?.workspace) save(workspaceKey, account.workspace);

export const server = {
  // VITE_LOCAL_API_URL points Local and Sample at another local API (a second one, on its own port).
  url:
    source === "cloudflare"
      ? HOSTED_URL!
      : (import.meta.env.VITE_LOCAL_API_URL ?? "http://127.0.0.1:3030"),
  // An API from before workspaces could be made doesn't say which: then it's the team's first one.
  workspace: account?.workspace ?? (source === "sample" ? "sample" : "local"),
};

// Into another of your workspaces, or the one you just made or joined.
export function openWorkspace(id: string): void {
  save(workspaceKey, id);
  location.hash = "";
  location.reload();
}
// To the screen for making or joining a workspace, from the app.
export function chooseWorkspace(): void {
  location.hash = "workspaces";
  location.reload();
}
// Signing in or out reloads as whoever you are now.
window.onAuthenticated(() => location.reload());
export async function signOut(): Promise<void> {
  await window.signOut();
  location.reload();
}

type Theme = "dark" | "light";
const [chosen, setChosen] = createSignal<Theme>(saved("theme", "dark"));
export const theme = chosen;
const LIGHT = (stylex.attrs(lightTheme).class ?? "").split(" ").filter(Boolean);
export function applyTheme(next: Theme): void {
  setChosen(next);
  save("theme", next);
  document.documentElement.dataset.theme = next;
  for (const name of LIGHT) document.documentElement.classList.toggle(name, next === "light");
  window.electron?.ipcRenderer.send("set-theme", next);
}
applyTheme(theme());
