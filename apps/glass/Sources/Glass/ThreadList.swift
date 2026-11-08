import SwiftUI
import Sync

/// The chosen mailbox's threads, as Mail lists messages: who wrote last and when, the title, the start of what they
/// wrote, then its properties; grouped by bucket in the inbox (the list in components/Mail.tsx).
struct ThreadList: SwiftUI.View {
  @Environment(Session.self) private var session

  var body: some SwiftUI.View {
    VStack(spacing: 0) {
      TopBar {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(session.mailboxTitle).font(.system(size: Theme.name, weight: .medium))
          if session.mailbox == .inbox, session.unreadCount > 0 {
            Text("\(session.unreadCount) unread").font(.system(size: Theme.small)).foregroundStyle(Theme.textTertiary)
          }
        }
        .padding(.leading, 8)
        Spacer()
        BarButton(name: "line.3.horizontal.decrease")
      }
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          let groups = session.listed
          if groups.isEmpty || groups.allSatisfy({ $0.threads.isEmpty }) {
            empty
          }
          ForEach(groups) { group in
            if let heading = group.bucket?.name ?? group.title, groups.count > 1 || group.bucket != nil {
              HStack(spacing: 6) {
                Image(systemName: group.bucket != nil ? "scope" : "ellipsis.circle").font(.system(size: 11))
                Text(heading)
                Text("\(group.threads.count)").fontWeight(.regular)
              }
              .font(.system(size: Theme.small, weight: .medium))
              .foregroundStyle(Theme.textTertiary)
              .padding(.horizontal, 10)
              .frame(height: 26)
              .padding(.top, 6)
            }
            ForEach(Array(group.threads.enumerated()), id: \.element.id) { at, thread in
              let on = session.openThreadId == thread.id
              let nextOn = at + 1 < group.threads.count && session.openThreadId == group.threads[at + 1].id
              ThreadRow(thread: thread)
              if at < group.threads.count - 1 {
                Rectangle().fill(on || nextOn ? .clear : Theme.strokeTertiary).frame(height: 1)
                  .padding(.leading, 28).padding(.trailing, 10)
              }
            }
          }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 12)
      }
    }
  }

  private var empty: some SwiftUI.View {
    VStack(spacing: 6) {
      Text(session.mailbox == .inbox ? "Inbox zero" : "Nothing here").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textSecondary)
      Text(session.mailbox == .inbox ? "Everything that needed you is done." : "No threads in this mailbox yet.").foregroundStyle(Theme.textTertiary)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 64)
  }
}

struct ThreadRow: SwiftUI.View {
  @Environment(Session.self) private var session
  let thread: ThreadModel
  @State private var hover = false

  private var last: Message? { thread.messages.sorted(byDate: "createdAt").last }
  private var from: User? { last?.author ?? thread.owner }

  /// What a message says, without the @mentions most start with.
  private var preview: String {
    var text = session.plain(last?.body ?? thread.description ?? "")
    let names = session.store.all(User.self).map { "@\($0.name) " }
    while let lead = names.first(where: { text.hasPrefix($0) }) { text = String(text.dropFirst(lead.count)) }
    return text
  }

  var body: some SwiftUI.View {
    let on = session.openThreadId == thread.id
    let item = session.itemFor(thread)
    let isUnread = item.map { $0.doneAt == nil && session.unread($0) } ?? false
    let labels = thread.labelIds.compactMap { session.store.find(Label.self, $0)?.name }
    Button { session.open(thread) } label: {
      HStack(alignment: .top, spacing: 8) {
        ZStack {
          if isUnread { Circle().fill(Theme.systemBlue).frame(width: 8, height: 8) }
        }
        .frame(width: 12)
        .padding(.top, 5)
        VStack(alignment: .leading, spacing: 1) {
          HStack(spacing: 8) {
            HStack(spacing: 6) {
              Identicon(seed: from?.id ?? thread.ownerId ?? "", size: 16)
              Text(from?.name ?? "").font(.system(size: Theme.name, weight: .semibold)).lineLimit(1)
            }
            Spacer()
            Text(stamp(last?.createdAt ?? thread.createdAt)).font(.system(size: Theme.small)).monospacedDigit().foregroundStyle(Theme.textTertiary)
          }
          .padding(.bottom, 3)
          HStack(spacing: 4) {
            if thread.priority == "urgent" { Text("!!").font(.system(size: Theme.body, weight: .bold)).foregroundStyle(Theme.urgent) }
            else if thread.priority == "high" { Text("!").font(.system(size: Theme.body, weight: .bold)).foregroundStyle(Theme.priorityHigh) }
            Text(thread.title).font(.system(size: Theme.body, weight: isUnread ? .semibold : .regular)).lineLimit(1)
            if !thread.isOpen { Image(systemName: "checkmark.circle").font(.system(size: 11)).foregroundStyle(Theme.textTertiary) }
          }
          Text(preview).font(.system(size: Theme.body)).foregroundStyle(Theme.textTertiary).lineLimit(2).fixedSize(horizontal: false, vertical: true)
          if thread.dueAt != nil || !labels.isEmpty {
            HStack(spacing: 6) {
              if let due = thread.dueAt {
                HStack(spacing: 3) {
                  Image(systemName: "calendar").font(.system(size: 10))
                  Text(shortDate(due))
                }
                .font(.system(size: Theme.small))
                .foregroundStyle(dueSoon(due) ? Theme.urgent : Theme.textTertiary)
              }
              ForEach(labels, id: \.self) { name in
                Text(name).font(.system(size: Theme.small)).foregroundStyle(Theme.textSecondary)
                  .padding(.horizontal, 6).frame(height: 16)
                  .background(Capsule().fill(Theme.bgTertiary))
              }
            }
            .padding(.top, 3)
          }
        }
      }
      .padding(EdgeInsets(top: 9, leading: 8, bottom: 10, trailing: 10))
      .background(RoundedRectangle(cornerRadius: Theme.rowRadius, style: .continuous).fill(on ? Theme.bgTertiary : hover ? Theme.bgQuaternary : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hover = $0 }
  }
}
