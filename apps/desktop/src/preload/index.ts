import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { setupRenderer } from "@better-auth/electron/preload";

contextBridge.exposeInMainWorld("electron", electronAPI);

// Signing in (src/main/signIn.ts): Better Auth's bridges (`requestAuth`, `authenticate`, `onAuthenticated`, `signOut`, …)
// and who you're signed in as. The session itself never reaches the window.
setupRenderer();
contextBridge.exposeInMainWorld("threads", {
  signedIn: (workspace?: string) => ipcRenderer.invoke("threads:signed-in", workspace),
  call: (path: string, body?: unknown) => ipcRenderer.invoke("threads:call", path, body),
  signOut: () => ipcRenderer.invoke("threads:sign-out"),
  // Who you are (or where) changed since the window drew what was kept: it loads again.
  onChanged: (callback: () => void) => ipcRenderer.on("threads:changed", () => callback()),
  source: () => ipcRenderer.invoke("threads:source"),
  useSource: (source: string) => ipcRenderer.invoke("threads:use-source", source),
});
