import { app, BrowserWindow, ipcMain, nativeTheme, shell, systemPreferences } from "electron";
import { createServer } from "node:http";
import { join } from "node:path";

const SIGN_IN_PORT = 47821;
const GROUND = { dark: "#141414", light: "#fafafa" };

let window: BrowserWindow | undefined;
let quitting = false;

function show() {
  if (!window) return createWindow();
  window.show();
}

function createWindow() {
  const created = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 13, y: 12 },
    backgroundColor: GROUND.dark,
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  window = created;
  created.on("ready-to-show", () => (app.isPackaged ? created.show() : created.showInactive()));
  created.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    created.hide();
  });
  created.on("closed", () => (window = undefined));

  const home = process.env.ELECTRON_RENDERER_URL;
  const openOutside = (url: string) => void shell.openExternal(url);
  created.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(home ?? "file:")) return;
    event.preventDefault();
    openOutside(url);
  });
  created.webContents.setWindowOpenHandler(({ url }) => (openOutside(url), { action: "deny" }));

  if (home) void created.loadURL(home);
  else void created.loadFile(join(__dirname, "../renderer/index.html"));
}

ipcMain.on("theme", (_event, theme: "dark" | "light") => {
  nativeTheme.themeSource = theme;
  window?.setBackgroundColor(GROUND[theme]);
});

let signingIn: Promise<string> | undefined;
ipcMain.handle("sign-in", () => {
  signingIn ??= new Promise<string>((resolve) => {
    const server = createServer((request, response) => {
      const code = new URL(request.url!, "http://127.0.0.1").searchParams.get("code");
      response.end("Signed in. You can close this tab.");
      if (!code) return;
      server.close();
      signingIn = undefined;
      show();
      resolve(code);
    }).listen(SIGN_IN_PORT, "127.0.0.1");
  });
  return signingIn;
});

app.on("before-quit", () => (quitting = true));
app.on("activate", show);

void app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  if (process.platform === "darwin")
    systemPreferences.registerDefaults({
      NSTextInsertionPointBlinkPeriodOn: 1e9,
      NSTextInsertionPointBlinkPeriodOff: 0,
    });
  createWindow();
});
