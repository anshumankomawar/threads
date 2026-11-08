import SwiftUI

// The desktop app's tokens (styles/tokens.stylex.ts on solid-email), dark, over glass. Text and strokes are white at
// the app's percentages; the chrome, frosted and panel colours become glass tints, since the wallpaper is the ground.

enum Theme {
  static let textPrimary = Color.white.opacity(0.955)
  static let textSecondary = Color.white.opacity(0.74)
  static let textTertiary = Color.white.opacity(0.60)
  static let iconTertiary = Color.white.opacity(0.52)
  static let bgTertiary = Color.white.opacity(0.09)
  static let bgQuaternary = Color.white.opacity(0.05)
  static let strokeTertiary = Color.white.opacity(0.08)
  static let strokeFocused = Color.white.opacity(0.15)
  static let accent = Color(red: 0x78 / 255, green: 0xae / 255, blue: 0xe7 / 255)
  static let accentFill = Color(red: 0x1f / 255, green: 0x25 / 255, blue: 0x2c / 255)
  static let systemBlue = Color(red: 0x0a / 255, green: 0x84 / 255, blue: 0xff / 255)
  static let statusClosed = Color(hue: 155 / 360, saturation: 0.45, brightness: 0.78)
  static let urgent = Color(hue: 355 / 360, saturation: 0.72, brightness: 0.88)
  static let priorityHigh = Color(red: 1, green: 0x9f / 255, blue: 0x0a / 255)

  // How much of the glass each column darkens: the sidebar most, then the list, the reading pane least.
  static let sidebarTint = Color.black.opacity(0.42)
  static let listTint = Color.black.opacity(0.30)
  static let paneTint = Color.black.opacity(0.22)

  static let rowRadius: CGFloat = 10
  static let controlRadius: CGFloat = 6
  static let body: CGFloat = 12
  static let name: CGFloat = 13
  static let message: CGFloat = 15
  static let small: CGFloat = 11
}

extension View {
  /// A row's or control's fill on hover, as `base.hover`.
  func hoverFill(_ on: Bool, radius: CGFloat = Theme.rowRadius) -> some View {
    background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(on ? Theme.bgQuaternary : .clear))
  }
}
