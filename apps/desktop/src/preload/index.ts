import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { userInfo } from "os";

// The local account, used to seed the user's avatar.
const user = { username: userInfo().username };

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("user", user);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.user = user;
}
