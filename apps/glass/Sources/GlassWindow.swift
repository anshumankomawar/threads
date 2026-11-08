import AppKit
import SwiftUI

// The window as a pane of dark glass over the desktop: the content fills it under a title bar that's only the
// traffic lights, its own background cleared so the vibrancy shows through everything, and a dark backing tint so the
// wallpaper reads as a picture behind the UI rather than the UI sitting on the wallpaper.
struct GlassWindow: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    DispatchQueue.main.async { configure(view.window) }
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {
    configure(view.window)
  }

  private func configure(_ window: NSWindow?) {
    guard let window else { return }
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.styleMask.insert(.fullSizeContentView)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.isMovableByWindowBackground = true
    // Dark, whatever the system is set to: the glass is a dark material.
    window.appearance = NSAppearance(named: .darkAqua)
  }
}

// The frosted layer itself. `behindWindow` samples the desktop and other windows behind this one; `.hudWindow` is the
// darkest of the standard materials, and `.active` keeps it live while the window is in the back too.
struct Frost: NSViewRepresentable {
  func makeNSView(context: Context) -> NSVisualEffectView {
    let view = NSVisualEffectView()
    view.blendingMode = .behindWindow
    view.material = .hudWindow
    view.state = .active
    return view
  }

  func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}
