import { app, shell, BrowserWindow, ipcMain, Menu, nativeTheme, systemPreferences } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import iconDark from "../../resources/icon-dark.png?asset";
import { setupSignIn } from "./signIn";

// A second copy for development, run beside the usual one (THREADS_SIDE_BY_SIDE=<folder>): its own data folder and
// DevTools port (THREADS_DEBUG_PORT), it doesn't claim the sign-in link, and with THREADS_HIDDEN set its window is never
// shown (drive it over the DevTools protocol), so it can't disturb the copy you're using.
const sideBySide = is.dev ? process.env["THREADS_SIDE_BY_SIDE"] : undefined;
const hidden = sideBySide !== undefined && process.env["THREADS_HIDDEN"] !== undefined;
if (sideBySide) app.setPath("userData", sideBySide);

// Signing in through the browser (src/main/signIn.ts), which has to be set up before the app is ready.
setupSignIn({ claimLink: !sideBySide });

const UI_SCALE = 1.1;

// The app's name in its menus ("About Arc", "Quit Arc"). The data folder is fixed first, since it follows the name:
// in development it stays "desktop", so renaming keeps saved settings, drafts and caches.
const userData = sideBySide ?? app.getPath("userData");
app.setName("Arc");
app.setPath("userData", userData);

// In development, expose the Chrome DevTools protocol on localhost so scripts can drive and inspect the app.
if (is.dev)
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env["THREADS_DEBUG_PORT"] ?? "9333",
  );

// The Dock icon in the app's theme. A packaged app on macOS 26 has the Icon Composer bundle, which macOS switches
// itself (with Liquid Glass, clear and tinted); in development, and on older macOS, the Dock shows this instead.
function syncDockIcon(): void {
  if (process.platform !== "darwin") return;
  if (app.isPackaged && Number(process.getSystemVersion().split(".")[0]) >= 26) return;
  app.dock?.setIcon(nativeTheme.shouldUseDarkColors ? iconDark : icon);
}

// The app keeps running when its window is closed: closing only hides the window, so the data stays loaded and synced,
// and the Dock icon (or opening the app again, or a sign-in link) shows it. Quitting (⌘Q) is the only way out.
let appWindow: BrowserWindow | undefined;
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

function showWindow(): void {
  if (!app.isReady() || hidden) return;
  if (appWindow === undefined) return createWindow();
  if (appWindow.isMinimized()) appWindow.restore();
  appWindow.show();
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
          // Centered on the top bar at the 110% scale (macOS draws them unscaled): 34px × 1.1 is 37.4pt, so their
          // centres (y + 6.75) sit at 18.75pt, level with its icons.
          trafficLightPosition: { x: 9, y: 12 },
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

  appWindow = mainWindow;
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("closed", () => {
    appWindow = undefined;
  });

  // The whole interface at 110%: the same layout, a little roomier. Set on every load, since a reload resets it.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.setZoomFactor(UI_SCALE);
  });

  mainWindow.on("ready-to-show", () => {
    if (hidden) return;
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
  if (hidden) app.dock?.hide();

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

  // The Dock icon, opening the app again, and a sign-in link coming back all bring the window back.
  app.on("activate", showWindow);
  app.on("second-instance", showWindow);
  app.on("open-url", showWindow);
});

// The window only closes for real when quitting, so this is the app on its way out.
app.on("window-all-closed", () => {
  app.quit();
});
