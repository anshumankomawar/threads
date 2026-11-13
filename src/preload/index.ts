import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("theme", theme),
  google: (url: string): Promise<string | null> => ipcRenderer.invoke("google", url),
});
