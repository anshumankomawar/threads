import SwiftUI
import Sync

/// Mail's layout: the sidebar of mailboxes, the chosen one's threads beside it, and the open thread beside them, all
/// on one pane of glass with the grid pressed into it.
struct MailView: SwiftUI.View {
  @Environment(Session.self) private var session

  var body: some SwiftUI.View {
    ZStack {
      Frost()
      Color.black.opacity(0.35)
      DotGrid()
      HStack(spacing: 0) {
        Sidebar().frame(width: 220).background(Theme.sidebarTint)
        Divider().overlay(Theme.strokeTertiary)
        ThreadList().frame(width: 340).background(Theme.listTint)
        Divider().overlay(Theme.strokeTertiary)
        ReadingPane().frame(maxWidth: .infinity).background(Theme.paneTint)
      }
    }
    .ignoresSafeArea()
    .preferredColorScheme(.dark)
    .font(.system(size: Theme.body))
    .foregroundStyle(Theme.textPrimary)
  }
}

// MARK: - Shared bits

/// The 34pt top bar every column has; the sidebar's leaves room for the lights.
struct TopBar<Content: SwiftUI.View>: SwiftUI.View {
  var afterLights = false
  @ViewBuilder let content: Content
  var body: some SwiftUI.View {
    HStack(spacing: 2.5) { content }
      .padding(.leading, afterLights ? 69 : 8)
      .padding(.trailing, 8)
      .frame(height: 34)
  }
}

struct BarButton: SwiftUI.View {
  let name: String
  var action: () -> Void = {}
  @State private var hover = false
  var body: some SwiftUI.View {
    Button(action: action) {
      Image(systemName: name)
        .font(.system(size: 12, weight: .medium))
        .frame(width: 22, height: 22)
        .foregroundStyle(Theme.textPrimary)
        .hoverFill(hover, radius: Theme.controlRadius)
    }
    .buttonStyle(.plain)
    .onHover { hover = $0 }
  }
}

/// A hollow ring while open, filled once it's resolved or blocked.
struct StateDot: SwiftUI.View {
  let state: String
  var body: some SwiftUI.View {
    Circle()
      .strokeBorder(state == "open" ? Theme.iconTertiary : state == "resolved" ? Theme.statusClosed : Theme.urgent, lineWidth: 1.5)
      .background(Circle().fill(state == "open" ? .clear : state == "resolved" ? Theme.statusClosed : Theme.urgent))
      .frame(width: 8, height: 8)
  }
}

/// Text with its thread links and mentions live.
struct LinkedText: SwiftUI.View {
  @Environment(Session.self) private var session
  let text: String

  var body: some SwiftUI.View { composed }

  private var composed: Text {
    var out = Text("")
    for part in splitText(text) {
      switch part {
      case .text(let s): out = out + Text(s)
      case .person(let id): out = out + Text("@\(session.name(id) ?? "someone")").foregroundColor(Theme.accent)
      case .subspace(let id): out = out + Text("@\(session.subspaceName(id) ?? "subspace")").foregroundColor(Theme.accent)
      case .thread(let id): out = out + Text("#\(session.title(id) ?? "thread")").foregroundColor(Theme.accent)
      case .date(let d): out = out + Text(shortDate(d))
      }
    }
    return out
  }
}
