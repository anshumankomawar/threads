import { app, shell, BrowserWindow, ipcMain, Menu, nativeTheme, systemPreferences } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import iconDark from "../../resources/icon-dark.png?asset";
import { setupSignIn } from "./signIn";

// Signing in through the browser (src/main/signIn.ts), which has to be set up before the app is ready.
setupSignIn();

const UI_SCALE = 1.1;

// The app's name in its menus ("About Arc", "Quit Arc"). The data folder is fixed first, since it follows the name:
// in development it stays "desktop", so renaming keeps saved settings, drafts and caches.
const userData = app.getPath("userData");
app.setName("Arc");
app.setPath("userData", userData);

// In development, expose the Chrome DevTools protocol on localhost so scripts can drive and inspect the app.
if (is.dev) app.commandLine.appendSwitch("remote-debugging-port", "9333");

// The Dock icon in the app's theme. A packaged app on macOS 26 has the Icon Composer bundle, which macOS switches
// itself (with Liquid Glass, clear and tinted); in development, and on older macOS, the Dock shows this instead.
function syncDockIcon(): void {
  if (process.platform !== "darwin") return;
  if (app.isPackaged && Number(process.getSystemVersion().split(".")[0]) >= 26) return;
  app.dock?.setIcon(nativeTheme.shouldUseDarkColors ? iconDark : icon);
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    // Cursor's dark glass backdrop: native sidebar vibrancy under a 25% black tint.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden",
          // Centered on the top bar at the 110% scale (macOS draws them unscaled).
          trafficLightPosition: { x: 9, y: 11 },
          vibrancy: "sidebar",
          visualEffectState: "active",
          backgroundColor: "#40000000",
        }
      : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  // The whole interface at 110%: the same layout, a little roomier. Set on every load, since a reload resets it.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.setZoomFactor(UI_SCALE);
  });

  mainWindow.on("ready-to-show", () => {
    // In dev, open without stealing focus so the window manager doesn't jump workspaces.
    if (is.dev) {
      mainWindow.showInactive();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  // In development, electron-vite serves the renderer with hot reload.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.threads.arc");

  // Dark until the renderer says otherwise (it sends its saved theme as it starts), so the vibrancy material matches.
  nativeTheme.themeSource = "dark";
  syncDockIcon();
  nativeTheme.on("updated", syncDockIcon);
  // The renderer's theme (⌘K): the vibrancy material follows it, under a black tint in dark mode and none in light.
  ipcMain.on("set-theme", (event, theme: unknown) => {
    const light = theme === "light";
    nativeTheme.themeSource = light ? "light" : "dark";
    if (process.platform === "darwin") {
      BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(
        light ? "#00ffffff" : "#40000000",
      );
    }
  });

  // Stop the text caret blinking: Chromium reads these macOS defaults and treats an "on" period
  // over 60s as always visible. registerDefaults applies to this app only and isn't persisted.
  if (process.platform === "darwin") {
    systemPreferences.registerDefaults({
      NSTextInsertionPointBlinkPeriodOn: 1e9,
      NSTextInsertionPointBlinkPeriodOff: 0,
    });
  }

  // The standard menus minus page zoom: ⌘+, ⌘- and ⌘0 go to the app, which zooms only the main content.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );

  // F12 toggles DevTools in development; ⌘R is ignored in production.
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", function () {
    // macOS: clicking the Dock icon with no windows open makes one.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when the last window closes, except on macOS, where apps stay open until ⌘Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
