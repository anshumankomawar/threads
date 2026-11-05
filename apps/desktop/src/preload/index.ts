import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { setupRenderer } from "@better-auth/electron/preload";

contextBridge.exposeInMainWorld("electron", electronAPI);

// Signing in (src/main/signIn.ts): Better Auth's bridges (`requestAuth`, `authenticate`, `onAuthenticated`, `signOut`, …)
// and who you're signed in as. The session itself never reaches the window.
setupRenderer();
contextBridge.exposeInMainWorld("threads", {
  signedIn: () => ipcRenderer.invoke("threads:signed-in"),
  sendCode: (email: string) => ipcRenderer.invoke("threads:send-code", email),
  verifyCode: (email: string, code: string) =>
    ipcRenderer.invoke("threads:verify-code", email, code),
});
