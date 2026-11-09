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
  source: () => ipcRenderer.invoke("threads:source"),
  useSource: (source: string) => ipcRenderer.invoke("threads:use-source", source),
});
