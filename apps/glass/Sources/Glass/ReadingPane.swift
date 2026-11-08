import SwiftUI
import Sync

/// The reading pane: the open thread as a conversation (components/ThreadView.tsx), or nothing but the glass.
struct ReadingPane: SwiftUI.View {
  @Environment(Session.self) private var session

  var body: some SwiftUI.View {
    VStack(spacing: 0) {
      TopBar {
        BarButton(name: "chevron.left")
        BarButton(name: "chevron.right").opacity(0.35)
        if let t = session.openThread {
          Text(t.title).foregroundStyle(Theme.textSecondary).lineLimit(1).padding(.leading, 6)
        }
        Spacer()
        if session.openThread != nil { BarButton(name: "ellipsis") }
        ConnectionDot()
      }
      if let t = session.openThread {
        ThreadView(thread: t).id(t.id)
      } else {
        Spacer()
      }
    }
  }
}

/// The store's connection: nothing while live, a word while it isn't.
struct ConnectionDot: SwiftUI.View {
  @Environment(Session.self) private var session
  var body: some SwiftUI.View {
    let c = session.store.connection
    if c != .live {
      Text(c == .connecting ? "Connecting" : "Offline")
        .font(.system(size: Theme.small))
        .foregroundStyle(Theme.textTertiary)
        .padding(.horizontal, 6)
    }
  }
}

private let TURN_GAP: CGFloat = 28
private let AVATAR: CGFloat = 28

struct ThreadView: SwiftUI.View {
  @Environment(Session.self) private var session
  let thread: ThreadModel
  @State private var reply = ""
  @FocusState private var replying: Bool

  /// A message or an activity line, with its id and time taken up front so the list needs no isolation to sort.
  private struct Entry: Identifiable {
    enum Kind { case message(Message), activity(Activity) }
    let id: String
    let at: Date
    let kind: Kind
  }

  private var entries: [Entry] {
    (thread.messages.map { Entry(id: $0.id, at: $0.createdAt, kind: .message($0)) }
      + thread.activity.map { Entry(id: $0.id, at: $0.createdAt, kind: .activity($0)) })
      .sorted { $0.at < $1.at }
  }

  var body: some SwiftUI.View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: TURN_GAP) {
          header
          let list = entries
          ForEach(Array(list.enumerated()), id: \.element.id) { at, entry in
            switch entry.kind {
            case .message(let m):
              // A message carries on the one before when it's the same person's, soon after.
              let grouped: Bool = {
                guard at > 0, case .message(let prev) = list[at - 1].kind else { return false }
                return prev.authorId == m.authorId && m.createdAt.timeIntervalSince(prev.createdAt) < 3600
              }()
              MessageBlock(message: m, grouped: grouped, mine: m.authorId == session.me)
                .padding(.top, grouped ? -(TURN_GAP - 6) : 0)
            case .activity(let a):
              ActivityLine(activity: a)
            }
          }
          if thread.isOpen { replyBox }
          Color.clear.frame(height: 1).id("end")
        }
        .padding(EdgeInsets(top: 16, leading: 32, bottom: 48, trailing: 32))
        .frame(maxWidth: 773 + 64, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .onChange(of: thread.messages.count) { withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
    }
  }

  private var header: some SwiftUI.View {
    HStack(alignment: .top, spacing: 14) {
      Identicon(seed: thread.ownerId ?? "", size: AVATAR).padding(.top, 8)
      VStack(alignment: .leading, spacing: 6) {
        Meta(user: thread.owner, at: thread.createdAt)
        if let parent = thread.branchedFrom {
          HStack(spacing: 6) {
            Text("Branched from").foregroundStyle(Theme.textSecondary)
            ThreadChip(thread: parent)
          }
        }
        ForEach(thread.blockers.filter(\.isOpen)) { blocker in
          HStack(spacing: 6) {
            Text("Blocked on").foregroundStyle(Theme.textSecondary)
            ThreadChip(thread: blocker)
          }
        }
        Text(thread.title).font(.system(size: Theme.message, weight: .medium)).textSelection(.enabled)
        if let d = thread.description, !d.isEmpty {
          LinkedText(text: d).font(.system(size: Theme.message)).lineSpacing(5).textSelection(.enabled)
        }
        properties
        if !thread.branches.isEmpty { branches }
      }
    }
  }

  private var properties: some SwiftUI.View {
    let bucket = session.itemFor(thread).flatMap { $0.bucketId }.flatMap { session.store.find(Bucket.self, $0) }
    let labels = thread.labelIds.compactMap { session.store.find(Label.self, $0)?.name }
    let spaces = thread.subspaceIds.compactMap { session.store.find(Subspace.self, $0)?.name }
    let people = thread.assigneeIds.compactMap { session.store.find(User.self, $0) }
    return FlowRow(spacing: 2) {
      Property { StateDot(state: thread.state); Text(thread.state.capitalized) }
      if let bucket { Property { Image(systemName: "scope"); Text(bucket.name) } }
      if !labels.isEmpty { Property { Image(systemName: "tag"); Text(summary(labels)) } }
      Property { Image(systemName: "square.3.layers.3d"); Text(spaces.isEmpty ? "No space" : summary(spaces)) }
      Property {
        Image(systemName: people.count > 1 ? "person.2" : "person")
        Text(people.isEmpty ? "Nobody" : summary(people.map { $0.id == session.me ? "You" : $0.firstName }))
      }
      if thread.priority != "none" { Property { Text(thread.priority.capitalized) } }
      if let due = thread.dueAt { Property { Image(systemName: "calendar"); Text("Due \(shortDate(due))") } }
    }
    .padding(.leading, -6)
    .padding(.top, 4)
  }

  private var branches: some SwiftUI.View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 6) {
        Text("Branches").font(.system(size: Theme.small, weight: .semibold))
        let done = thread.branches.filter { !$0.isOpen }.count
        Text("\(done) of \(thread.branches.count) resolved").font(.system(size: Theme.small))
      }
      .foregroundStyle(Theme.textTertiary)
      .frame(height: 22)
      ForEach(thread.branches) { b in
        Button { session.open(b) } label: {
          HStack(spacing: 8) {
            StateDot(state: b.state)
            Text(b.title).lineLimit(1).foregroundStyle(b.isOpen ? Theme.textPrimary : Theme.textTertiary)
            Spacer()
            if b.isOpen, let due = b.dueAt { Text(shortDate(due)).foregroundStyle(Theme.textTertiary) }
            if let owner = b.owner { Identicon(seed: owner.id, size: 14) }
          }
          .padding(.horizontal, 6).frame(height: 26)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.top, 8)
  }

  private var replyBox: some SwiftUI.View {
    HStack(alignment: .top, spacing: 14) {
      Identicon(seed: session.me, size: AVATAR).padding(.top, 8)
      VStack(alignment: .leading, spacing: 2) {
        Text(session.user?.name ?? "You").font(.system(size: Theme.name, weight: .medium)).frame(height: 22)
        TextField("Reply to \(thread.owner.map { $0.id == session.me ? "yourself" : $0.firstName } ?? "the thread")…", text: $reply, axis: .vertical)
          .textFieldStyle(.plain)
          .font(.system(size: Theme.message))
          .lineSpacing(5)
          .focused($replying)
          .onSubmit(send)
          .onKeyPress(.return, phases: .down) { press in
            if press.modifiers.contains(.shift) { return .ignored }
            send()
            return .handled
          }
      }
    }
  }

  private func send() {
    let body = reply.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !body.isEmpty else { return }
    reply = ""
    session.send(thread, body)
  }
}

/// "Security", or "Security +1".
private func summary(_ names: [String]) -> String {
  names.count <= 1 ? names.first ?? "" : "\(names[0]) +\(names.count - 1)"
}

struct Meta: SwiftUI.View {
  let user: User?
  let at: Date
  var body: some SwiftUI.View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(user?.name ?? "Someone").font(.system(size: Theme.name, weight: .medium))
      Text(ago(at)).foregroundStyle(Theme.textTertiary)
    }
    .frame(height: 22)
  }
}

struct Property<Content: SwiftUI.View>: SwiftUI.View {
  @ViewBuilder let content: Content
  var body: some SwiftUI.View {
    HStack(spacing: 6) { content }
      .font(.system(size: Theme.body))
      .foregroundStyle(Theme.textSecondary)
      .padding(.horizontal, 6)
      .frame(height: 26)
  }
}

struct ThreadChip: SwiftUI.View {
  @Environment(Session.self) private var session
  let thread: ThreadModel
  var body: some SwiftUI.View {
    Button { session.open(thread) } label: {
      HStack(spacing: 4) {
        Image(systemName: "arrow.triangle.branch").font(.system(size: 10))
        Text(thread.title).lineLimit(1)
      }
      .font(.system(size: Theme.body))
      .foregroundStyle(Theme.accent)
      .padding(.horizontal, 6).frame(height: 20)
      .background(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).fill(Theme.accentFill))
    }
    .buttonStyle(.plain)
  }
}

struct MessageBlock: SwiftUI.View {
  @Environment(Session.self) private var session
  let message: Message
  let grouped: Bool
  let mine: Bool

  var body: some SwiftUI.View {
    HStack(alignment: .top, spacing: 14) {
      if mine { Spacer(minLength: 0) }
      if !mine {
        ZStack { if !grouped { Identicon(seed: message.authorId, size: AVATAR) } }.frame(width: AVATAR).padding(.top, 8)
      }
      VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
        if !grouped { Meta(user: message.author, at: message.createdAt) }
        LinkedText(text: message.body)
          .font(.system(size: Theme.message))
          .lineSpacing(5)
          .multilineTextAlignment(mine ? .trailing : .leading)
          .textSelection(.enabled)
          .frame(maxWidth: mine ? 560 : .infinity, alignment: mine ? .trailing : .leading)
      }
      if mine {
        ZStack { if !grouped { Identicon(seed: message.authorId, size: AVATAR) } }.frame(width: AVATAR).padding(.top, 8)
      }
    }
  }
}

struct ActivityLine: SwiftUI.View {
  let activity: Activity
  var body: some SwiftUI.View {
    HStack(alignment: .firstTextBaseline, spacing: 14) {
      ZStack { Circle().fill(Theme.iconTertiary).frame(width: 6, height: 6) }.frame(width: AVATAR, height: 18)
      (Text(activity.actor?.name ?? "Someone").foregroundColor(Theme.textSecondary) + Text(" ") + Text(verbatim: "") )
        .font(.system(size: Theme.body))
      + Text("")
    }
    .overlay(alignment: .leading) { EmptyView() }
    .foregroundStyle(Theme.textTertiary)
    .padding(.vertical, -6)
    .overlay(alignment: .leading) {
      HStack(alignment: .firstTextBaseline, spacing: 14) {
        Color.clear.frame(width: AVATAR, height: 18)
        HStack(spacing: 0) {
          Text(activity.actor?.name ?? "Someone").foregroundStyle(Theme.textSecondary)
          Text(" ")
          LinkedText(text: activity.text)
          Text(" · \(ago(activity.createdAt))")
        }
        .font(.system(size: Theme.body))
        .foregroundStyle(Theme.textTertiary)
      }
    }
  }
}

/// Items in a row that wrap to the next when they don't fit.
struct FlowRow<Content: SwiftUI.View>: SwiftUI.View {
  var spacing: CGFloat = 4
  @ViewBuilder let content: Content
  var body: some SwiftUI.View {
    FlowLayout(spacing: spacing) { content }
  }
}

struct FlowLayout: Layout {
  var spacing: CGFloat
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x + size.width > width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
    return CGSize(width: width == .infinity ? x : width, height: y + rowHeight)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
      s.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
  }
}
