import SwiftUI
import Sync

/// The sidebar: the title bar, the segments (Inbox, Spaces, Views), one group of mailboxes at a time, and you at the
/// bottom (`MailSidebar` in components/Mail.tsx).
struct Sidebar: SwiftUI.View {
  @Environment(Session.self) private var session

  var body: some SwiftUI.View {
    VStack(spacing: 0) {
      TopBar(afterLights: true) {
        BarButton(name: "sidebar.left")
        BarButton(name: "magnifyingglass")
        Spacer()
        BarButton(name: "square.and.pencil")
      }
      Segments()
        .padding(.horizontal, 8)
        .padding(.top, 2)
        .padding(.bottom, 8)
      ScrollView {
        VStack(alignment: .leading, spacing: 2) {
          switch session.group {
          case .mail: mailboxes
          case .spaces: spaces
          case .views: views
          }
        }
        .padding(.horizontal, 8)
        .padding(.top, 2)
        .padding(.bottom, 12)
      }
      Spacer(minLength: 0)
      footer
    }
  }

  @ViewBuilder private var mailboxes: some SwiftUI.View {
    let inbox = session.inbox
    MailboxRow(box: .inbox, label: "Buckets", icon: "tray", count: inbox.order.count)
    ForEach(session.myBuckets) { bucket in
      MailboxRow(box: .bucket(bucket.id), label: bucket.name, icon: "scope", count: inbox.sections.first { $0.bucket.id == bucket.id }?.items.count ?? 0, indent: true)
    }
    if !inbox.unsorted.isEmpty {
      MailboxRow(box: .unsorted, label: "Sorting", icon: "ellipsis.circle", count: inbox.unsorted.count, indent: true)
    }
    MailboxRow(box: .sent, label: "Sent", icon: "paperplane", count: session.sent.count)
    MailboxRow(box: .drafts, label: "Drafts", icon: "square.and.pencil")
  }

  @ViewBuilder private var spaces: some SwiftUI.View {
    SectionTitle("Spaces")
    ForEach(session.store.all(Subspace.self).sorted { $0.name < $1.name }) { sub in
      MailboxRow(box: .subspace(sub.id), label: sub.name, icon: sub.isPrivate ? "lock" : "square.3.layers.3d")
    }
    SectionTitle("Labels").padding(.top, 14)
    ForEach(session.store.all(Label.self).sorted { $0.name < $1.name }) { label in
      MailboxRow(box: .label(label.id), label: label.name, icon: "tag")
    }
  }

  @ViewBuilder private var views: some SwiftUI.View {
    MailboxRow(box: .personal, label: "Personal", icon: "person")
    MailboxRow(box: .all, label: "Workspace", icon: "square.grid.2x2")
    ForEach(session.store.all(SavedView.self).filter { $0.shared || $0.ownerId == session.me }.sorted { $0.name < $1.name }) { saved in
      MailboxRow(box: .view(saved.id), label: saved.name, icon: "line.3.horizontal.decrease")
    }
  }

  private var footer: some SwiftUI.View {
    HStack(spacing: 4) {
      HStack(spacing: 8) {
        Identicon(seed: session.me, size: 18)
        Text(session.user?.name ?? "…").lineLimit(1)
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 6)
      .foregroundStyle(Theme.textSecondary)
      Spacer()
      BarButton(name: "gearshape")
    }
    .padding(.horizontal, 8)
    .padding(.bottom, 8)
  }
}

/// Icon tabs; the chosen one opens out to show its name.
struct Segments: SwiftUI.View {
  @Environment(Session.self) private var session
  private let icons: [SidebarGroup: String] = [.mail: "tray", .spaces: "square.3.layers.3d", .views: "eye"]

  var body: some SwiftUI.View {
    HStack(spacing: 2) {
      ForEach(SidebarGroup.allCases, id: \.self) { g in
        let on = session.group == g
        Button { withAnimation(.easeInOut(duration: 0.22)) { session.group = g } } label: {
          HStack(spacing: 6) {
            Image(systemName: icons[g]!).font(.system(size: 12, weight: .medium))
            if on { Text(g.rawValue).font(.system(size: 12)).transition(.opacity.combined(with: .move(edge: .leading))) }
          }
          .padding(.horizontal, 6)
          .frame(height: 24)
          .foregroundStyle(on ? Theme.textPrimary : Theme.iconTertiary)
          .background(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).fill(on ? Theme.bgTertiary : .clear))
        }
        .buttonStyle(.plain)
      }
      Spacer()
    }
  }
}

struct SectionTitle: SwiftUI.View {
  let title: String
  init(_ title: String) { self.title = title }
  var body: some SwiftUI.View {
    Text(title)
      .font(.system(size: Theme.small, weight: .semibold))
      .foregroundStyle(Theme.textTertiary)
      .padding(.horizontal, 6)
      .frame(height: 22)
  }
}

struct MailboxRow: SwiftUI.View {
  @Environment(Session.self) private var session
  let box: Mailbox
  let label: String
  let icon: String
  var count: Int = 0
  var indent = false
  @State private var hover = false

  var body: some SwiftUI.View {
    let on = session.mailbox == box
    Button { session.choose(box) } label: {
      HStack(spacing: 6) {
        Image(systemName: icon).font(.system(size: 12)).foregroundStyle(Theme.iconTertiary).frame(width: 16)
        Text(label).lineLimit(1).truncationMode(.tail)
        Spacer(minLength: 4)
        if count > 0 {
          Text("\(count)").font(.system(size: Theme.small)).monospacedDigit().foregroundStyle(Theme.textTertiary)
        }
      }
      .padding(.leading, 6)
      .padding(.trailing, 8)
      .frame(height: 26)
      .background(RoundedRectangle(cornerRadius: Theme.rowRadius, style: .continuous).fill(on ? Theme.bgTertiary : hover ? Theme.bgQuaternary : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .padding(.leading, indent ? 14 : 0)
    .onHover { hover = $0 }
  }
}
