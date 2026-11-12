import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("theme", theme),
  signIn: (): Promise<string> => ipcRenderer.invoke("sign-in"),
});
