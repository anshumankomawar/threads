// In development the app runs inside Electron's own Electron.app, so the Dock and the menu bar say "Electron".
// This renames that bundle (in node_modules only) to the app's name. Packaged builds get it from electron-builder.yml.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const NAME = "Arc";

if (process.platform === "darwin") {
  const electron = dirname(createRequire(import.meta.url).resolve("electron/package.json"));
  const plist = join(electron, "dist", "Electron.app", "Contents", "Info.plist");
  for (const key of ["CFBundleName", "CFBundleDisplayName"])
    execFileSync("plutil", ["-replace", key, "-string", NAME, plist]);
  // macOS keeps an app's name from when it first saw it: have it read the bundle again, or it still says Electron.
  const lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  execFileSync(lsregister, ["-f", join(electron, "dist", "Electron.app")]);
}
