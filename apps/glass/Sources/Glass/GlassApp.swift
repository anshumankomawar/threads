import SwiftUI
import Sync

// Arc's native client: Mail's three columns (components/Mail.tsx on solid-email) on a pane of frosted glass, over the
// Swift sync engine. It opens the sample workspace on the local API as "you" (`ARC_API`, `ARC_WORKSPACE`, `ARC_TOKEN`
// in the environment change that), so it shows the same data as the desktop app's Sample source.

@main
struct GlassApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var session: Session

  init() {
    registerThreadsModels()
    let env = ProcessInfo.processInfo.environment
    let url = URL(string: env["ARC_API"] ?? "http://127.0.0.1:3030")!
    let workspace = env["ARC_WORKSPACE"] ?? "sample"
    let token = env["ARC_TOKEN"] ?? "you"
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Arc Glass")
    let store = Store(transport: HTTPTransport(url: url, workspace: workspace, token: token), localDB: SQLiteLocalDB(directory: support, models: registry.all().map(\.name)), workspace: workspace, token: token)
    _session = State(initialValue: Session(store: store, me: token))
  }

  var body: some Scene {
    WindowGroup("Arc") {
      MailView()
        .environment(session)
        .frame(minWidth: 900, minHeight: 560)
        .background(GlassWindow())
    }
    .windowStyle(.hiddenTitleBar)
    .defaultSize(width: 1240, height: 820)
    .commands {
      CommandGroup(replacing: .newItem) {}
      CommandMenu("Thread") {
        Button("Next Thread") { session.step(1) }.keyboardShortcut("j", modifiers: [])
        Button("Previous Thread") { session.step(-1) }.keyboardShortcut("k", modifiers: [])
        Button("Mark Done") { if let t = session.openThread { session.markDone(t) } }.keyboardShortcut("e", modifiers: .command)
        Button("Resolve or Reopen") {
          if let t = session.openThread { session.setState(t, t.isOpen ? "resolved" : "open") }
        }.keyboardShortcut("e", modifiers: [.command, .shift])
      }
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
  }
}
