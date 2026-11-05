import { app, shell, BrowserWindow, ipcMain, Menu, nativeTheme, systemPreferences } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import iconDark from "../../resources/icon-dark.png?asset";

const UI_SCALE = 1.1;

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
  // Create the browser window.
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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
void app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

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

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
