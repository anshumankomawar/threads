import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  invite: (): Promise<string | null> => ipcRenderer.invoke("invite"),
  onInvite: (run: () => void) => {
    ipcRenderer.on("invite", run);
    return () => void ipcRenderer.off("invite", run);
  },
  saved: () => ipcRenderer.send("saved"),
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("theme", theme),
  google: (url: string): Promise<string | null> => ipcRenderer.invoke("google", url),
});
