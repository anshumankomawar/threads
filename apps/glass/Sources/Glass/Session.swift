import Foundation
import Observation
import Sync

/// The saved-query model, under a name that doesn't shadow SwiftUI's `View` in the app's files.
typealias SavedView = Sync.View
/// Threads' thread, under a name that doesn't shadow Foundation's `Thread`.
typealias ThreadModel = Sync.Thread

// The app's state over the store (apps/desktop's session.ts and mail.ts on solid-email): who you are, which mailbox is
// chosen, which thread is open, and the derived lists the columns show.

/// What the middle column lists.
enum Mailbox: Hashable {
  case inbox, unsorted, personal, sent, drafts, all
  case bucket(String), subspace(String), label(String), person(String), view(String)
}

enum SidebarGroup: String, CaseIterable { case mail = "Inbox", spaces = "Spaces", views = "Views" }

/// A group of rows under a heading: the inbox lists each bucket apart.
struct Group: Identifiable {
  let key: String
  var bucket: Bucket?
  var title: String?
  var threads: [ThreadModel]
  var id: String { key }
}

@MainActor
@Observable
final class Session {
  let store: Store
  let me: String
  var mailbox: Mailbox = .inbox
  var group: SidebarGroup = .mail
  var openThreadId: String?

  init(store: Store, me: String) {
    self.store = store
    self.me = me
  }

  var user: User? { store.find(User.self, me) }
  var workspace: Workspace? { store.all(Workspace.self).first }
  var openThread: ThreadModel? { openThreadId.flatMap { store.find(ThreadModel.self, $0) } }

  func name(_ id: String) -> String? { store.find(User.self, id)?.name }
  func title(_ id: String) -> String? { store.find(ThreadModel.self, id)?.title }
  func subspaceName(_ id: String) -> String? { store.find(Subspace.self, id)?.name }
  func plain(_ text: String) -> String { plainText(text, titleOf: title, nameOf: name, subspaceOf: subspaceName) }

  var myBuckets: [Bucket] { store.where(Bucket.self, "userId", .string(me)).sorted { $0.position < $1.position } }

  func lastActive(_ t: ThreadModel) -> Date {
    max(t.updatedAt, t.messages.sorted(byDate: "createdAt").last?.createdAt ?? .distantPast)
  }

  /// Your inbox: open, undone items, most urgent first, in their buckets, with what the model hasn't sorted yet apart.
  var inbox: (sections: [(bucket: Bucket, items: [InboxItem])], unsorted: [InboxItem], order: [ThreadModel]) {
    let rank = ["urgent": 0, "high": 1, "medium": 2, "low": 3, "none": 4]
    let items = store.where(InboxItem.self, "userId", .string(me))
      .filter { ($0.thread?.isOpen ?? false) && $0.doneAt == nil }
      .sorted { a, b in
        guard let x = a.thread, let y = b.thread else { return false }
        if (x.state == "blocked") != (y.state == "blocked") { return y.state == "blocked" }
        if rank[x.priority] != rank[y.priority] { return (rank[x.priority] ?? 4) < (rank[y.priority] ?? 4) }
        let dx = x.dueAt ?? .distantFuture, dy = y.dueAt ?? .distantFuture
        if dx != dy { return dx < dy }
        return lastActive(x) > lastActive(y)
      }
    let buckets = myBuckets
    let sections = buckets.map { b in (bucket: b, items: items.filter { $0.bucketId == b.id }) }
    let unsorted = items.filter { item in !buckets.contains { $0.id == item.bucketId } }
    return (sections, unsorted, (unsorted + sections.flatMap(\.items)).compactMap(\.thread))
  }

  /// What you asked of others: your open threads with someone else on them, not in your inbox.
  var sent: [ThreadModel] {
    let inboxOrder = Set(inbox.order.map(\.id))
    return store.where(ThreadModel.self, "ownerId", .string(me))
      .filter { $0.isOpen && !inboxOrder.contains($0.id) && $0.assigneeIds.contains { $0 != me } }
      .sorted { lastActive($0) > lastActive($1) }
  }

  func itemFor(_ t: ThreadModel) -> InboxItem? { t.inboxItems.first { $0.userId == me } }

  func hasNew(_ item: InboxItem) -> Bool {
    let seen = item.seenAt ?? .distantPast
    return item.thread?.messages.contains { $0.authorId != me && $0.createdAt > seen } ?? false
  }

  /// The thread you're reading is never unread.
  func unread(_ item: InboxItem) -> Bool { item.threadId != openThreadId && hasNew(item) }

  private func newestFirst(_ threads: [ThreadModel]) -> [ThreadModel] {
    threads.sorted { a, b in
      if a.isOpen != b.isOpen { return a.isOpen }
      return lastActive(a) > lastActive(b)
    }
  }

  /// The chosen mailbox's threads, grouped as they're shown.
  var listed: [Group] {
    let all = store.all(ThreadModel.self)
    switch mailbox {
    case .inbox:
      let (sections, unsorted, _) = inbox
      return ([Group(key: "unsorted", title: "Sorting", threads: unsorted.compactMap(\.thread))]
        + sections.map { Group(key: $0.bucket.id, bucket: $0.bucket, threads: $0.items.compactMap(\.thread)) })
        .filter { !$0.threads.isEmpty }
    case .unsorted: return [Group(key: "unsorted", threads: inbox.unsorted.compactMap(\.thread))]
    case .bucket(let id):
      return [Group(key: id, threads: (inbox.sections.first { $0.bucket.id == id }?.items ?? []).compactMap(\.thread))]
    case .sent: return [Group(key: "sent", threads: sent)]
    case .personal: return [Group(key: "personal", threads: newestFirst(all.filter { $0.ownerId == me || $0.assigneeIds.contains(me) }))]
    case .drafts: return []
    case .all: return [Group(key: "all", threads: newestFirst(all))]
    case .subspace(let id): return [Group(key: id, threads: newestFirst(all.filter { $0.subspaceIds.contains(id) }))]
    case .label(let id): return [Group(key: id, threads: newestFirst(all.filter { $0.labelIds.contains(id) }))]
    case .person(let id): return [Group(key: id, threads: newestFirst(all.filter { $0.ownerId == id || $0.assigneeIds.contains(id) }))]
    case .view(let id):
      guard let saved = store.find(SavedView.self, id) else { return [] }
      return [Group(key: id, threads: newestFirst(all.filter { matches($0, saved.filter, variables: ["me": .string(me)]) }))]
    }
  }

  var order: [ThreadModel] { listed.flatMap(\.threads) }

  var mailboxTitle: String {
    switch mailbox {
    case .inbox: "Buckets"
    case .unsorted: "Sorting"
    case .sent: "Sent"
    case .drafts: "Drafts"
    case .all: "Workspace"
    case .personal: "Personal"
    case .bucket(let id): store.find(Bucket.self, id)?.name ?? "Inbox"
    case .subspace(let id): store.find(Subspace.self, id)?.name ?? ""
    case .label(let id): store.find(Label.self, id)?.name ?? ""
    case .person(let id): store.find(User.self, id)?.name ?? ""
    case .view(let id): store.find(SavedView.self, id)?.name ?? ""
    }
  }

  var unreadCount: Int { inbox.order.compactMap(itemFor).filter(unread).count }

  // MARK: Actions

  func choose(_ box: Mailbox) {
    mailbox = box
    openThreadId = nil
    switch box {
    case .subspace, .label: group = .spaces
    case .personal, .all, .view, .person: group = .views
    default: group = .mail
    }
  }

  func open(_ t: ThreadModel) {
    if let was = openThread, let item = itemFor(was), hasNew(item) { item.set("seenAt", .date(Date())); item.save() }
    openThreadId = t.id
    if let item = itemFor(t) { item.set("seenAt", .date(Date())); item.save() }
  }

  func send(_ thread: ThreadModel, _ body: String) {
    store.create(Message.self, [
      "threadId": .string(thread.id), "authorId": .string(me), "body": .string(body),
      "workspaceId": .string(thread.workspaceId), "subspaceIds": .strings(thread.subspaceIds),
    ])
  }

  func markDone(_ t: ThreadModel) {
    guard let item = itemFor(t) else { return }
    item.set("doneAt", item.doneAt == nil ? .date(Date()) : .null)
    item.save()
  }

  func setState(_ t: ThreadModel, _ state: String) {
    t.set("state", .string(state))
    t.save()
  }

  /// J / K: the next or previous thread in the list.
  func step(_ by: Int) {
    let list = order
    guard !list.isEmpty else { return }
    let at = list.firstIndex { $0.id == openThreadId } ?? -1
    let next = min(max(at + by, 0), list.count - 1)
    open(list[next])
  }
}

// MARK: - Formatting, as Mail does it

func stamp(_ date: Date) -> String {
  let cal = Calendar.current
  if cal.isDateInToday(date) { return date.formatted(.dateTime.hour().minute()) }
  if cal.isDateInYesterday(date) { return "Yesterday" }
  return date.formatted(.dateTime.month(.abbreviated).day())
}

func shortDate(_ date: Date) -> String { date.formatted(.dateTime.month(.abbreviated).day()) }

func ago(_ date: Date) -> String {
  let f = RelativeDateTimeFormatter()
  f.unitsStyle = .abbreviated
  return f.localizedString(for: date, relativeTo: Date())
}

/// Today's and past due dates are urgent.
func dueSoon(_ due: Date) -> Bool { due < Calendar.current.startOfDay(for: Date()).addingTimeInterval(86_400) }
