import { app, BrowserWindow, ipcMain, nativeTheme, shell, systemPreferences } from "electron";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import icon from "../../build/icon.png?asset";
import iconDark from "../../resources/icon-dark.png?asset";
import fraunces from "../renderer/src/fonts/fraunces-latin-wght.woff2?asset";
import hanken from "../renderer/src/fonts/hanken-grotesk-latin-wght.woff2?asset";

const GROUND = { dark: "#101010", light: "#fafafa" };

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

const face = (family: string, file: string) =>
  `@font-face { font-family: "${family}"; font-weight: 100 900; src: url(data:font/woff2;base64,${readFileSync(file).toString("base64")}); }`;
const page = (title: string, line: string) => `<!doctype html>
<meta charset="utf-8">
<title>Arc</title>
<style>
  ${face("Fraunces", fraunces)}
  ${face("Hanken Grotesk", hanken)}
  body { display: grid; place-content: center; height: 100vh; margin: 0; text-align: center;
    color: rgb(255 255 255 / 92%); background: #101010; font: 14px/1.45 "Hanken Grotesk", sans-serif; }
  h1 { margin: 0; font: 300 36px/1.08 "Fraunces", serif; letter-spacing: -0.02em; }
  p { margin: 10px 0 0; color: rgb(255 255 255 / 62%); }
</style>
<h1>${title}</h1>
<p>${line}</p>`;

let waiting: Server | undefined;

ipcMain.handle(
  "google",
  (_event, url: string) =>
    new Promise<string | null>((resolve) => {
      waiting?.close();
      const server = createServer((request, response) => {
        const params = new URL(request.url ?? "/", "http://127.0.0.1").searchParams;
        if (!params.has("convexAuthCode") && !params.has("convexAuthError"))
          return void response.writeHead(404).end();
        response.setHeader("Content-Type", "text/html");
        response.end(
          params.has("convexAuthCode")
            ? page("You’re signed in", "You can close this tab and go back to Arc.")
            : page("Signing in didn’t finish", "Go back to Arc to try again."),
        );
        server.close();
        show();
        resolve(params.get("convexAuthCode"));
      });
      waiting = server;
      server.on("close", () => resolve(null));
      server.on("error", () => resolve(null));
      server.listen(47201, "127.0.0.1", () => void shell.openExternal(url));
      setTimeout(() => server.close(), 300_000);
    }),
);

ipcMain.on("theme", (_event, theme: "dark" | "light") => {
  nativeTheme.themeSource = theme;
  window?.setBackgroundColor(GROUND[theme]);
});

function syncDockIcon() {
  if (!app.isPackaged) app.dock?.setIcon(nativeTheme.shouldUseDarkColors ? iconDark : icon);
}

app.on("before-quit", () => (quitting = true));
app.on("activate", show);

void app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  nativeTheme.on("updated", syncDockIcon);
  syncDockIcon();
  if (process.platform === "darwin")
    systemPreferences.registerDefaults({
      NSTextInsertionPointBlinkPeriodOn: 1e9,
      NSTextInsertionPointBlinkPeriodOff: 0,
    });
  createWindow();
});
