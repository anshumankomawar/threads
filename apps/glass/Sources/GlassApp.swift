import SwiftUI

@main
struct GlassApp: App {
  // A package executable has no bundle to say it's a GUI app, so it says so itself: a Dock icon and the front.
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    WindowGroup("Glass") {
      ContentView()
        .frame(minWidth: 900, minHeight: 600)
        .background(GlassWindow())
    }
    .windowStyle(.hiddenTitleBar)
    .defaultSize(width: 1240, height: 820)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
  }
}
