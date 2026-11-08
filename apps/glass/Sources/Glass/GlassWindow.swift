import AppKit
import SwiftUI

/// The window as a pane of dark glass over the desktop: content under a title bar that's only the traffic lights,
/// its own background cleared so the vibrancy shows through everything.
struct GlassWindow: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    DispatchQueue.main.async { configure(view.window) }
    return view
  }

  func updateNSView(_ view: NSView, context: Context) { configure(view.window) }

  private func configure(_ window: NSWindow?) {
    guard let window else { return }
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.styleMask.insert(.fullSizeContentView)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.isMovableByWindowBackground = true
    window.appearance = NSAppearance(named: .darkAqua)
  }
}

/// The frosted layer: `behindWindow` samples the desktop and other windows behind this one.
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

/// The fine grid etched into the glass: a dot every few points, drawn once into a tile and repeated.
struct DotGrid: View {
  var spacing: CGFloat = 4
  var dot: CGFloat = 1

  var body: some View {
    Canvas { context, size in
      guard let tile = context.resolveSymbol(id: 0) else { return }
      var x: CGFloat = 0
      while x < size.width {
        var y: CGFloat = 0
        while y < size.height {
          context.draw(tile, at: CGPoint(x: x + spacing / 2, y: y + spacing / 2))
          y += spacing
        }
        x += spacing
      }
    } symbols: {
      ZStack {
        Rectangle().fill(.white.opacity(0.10)).frame(width: dot, height: dot).offset(y: 0.5)
        Rectangle().fill(.black.opacity(0.55)).frame(width: dot, height: dot)
      }
      .frame(width: spacing, height: spacing)
      .tag(0)
    }
    .allowsHitTesting(false)
  }
}
