import Foundation

// Threads' models (packages/models/src/models.ts), one class each, with the same fields, sync groups and names the
// server knows. Fields are read through the typed accessors so a SwiftUI view that reads one re-renders on change.

public let STATES = ["open", "resolved", "blocked"]
public let PRIORITIES = ["none", "low", "medium", "high", "urgent"]

private func inWorkspace(_ row: Row) -> [String] { ["workspace:\(row["workspaceId"]?.string ?? "")"] }
/// A thread, and what's in it, is its subspaces' (each one's members, and whoever follows it); in none, the workspace's.
private func inSubspaces(_ row: Row) -> [String] {
  let ids = row["subspaceIds"]?.strings ?? []
  return ids.isEmpty ? inWorkspace(row) : ids.map { "subspace:\($0)" }
}
private func base(_ fields: [String: FieldMeta]) -> [String: FieldMeta] {
  var all: [String: FieldMeta] = [
    "id": Field.property(), "createdAt": Field.property(date: true), "updatedAt": Field.property(date: true),
    "archivedAt": Field.property(nullable: true, date: true),
  ]
  all.merge(fields) { _, new in new }
  return all
}

public final class Workspace: Model {
  public static let metadata = ModelMeta(name: "Workspace", fields: base(["name": Field.property()]), syncGroup: { ["workspace:\($0.id)"] })
  public override var meta: ModelMeta { Self.metadata }
  public var name: String { string("name") }
}

/// A person, seen in every workspace they're a member of.
public final class User: Model {
  public static let metadata = ModelMeta(
    name: "User",
    fields: base(["name": Field.property(), "email": Field.property(nullable: true), "avatarUrl": Field.property(nullable: true), "workspaceIds": Field.property(), "memberships": Field.oneToMany("WorkspaceMember", key: "userId")]),
    syncGroup: { ($0["workspaceIds"]?.strings ?? []).map { "workspace:\($0)" } })
  public override var meta: ModelMeta { Self.metadata }
  public var name: String { string("name") }
  public var email: String? { optionalString("email") }
  public var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
}

public final class WorkspaceMember: Model {
  public static let metadata = ModelMeta(
    name: "WorkspaceMember",
    fields: base(["workspace": Field.reference("Workspace", key: "workspaceId"), "user": Field.reference("User", key: "userId"), "role": Field.property(enum: ["admin", "member"])]),
    syncGroup: inWorkspace)
  public override var meta: ModelMeta { Self.metadata }
  public var userId: String { string("userId") }
  public var role: String { string("role") }
}

public final class Label: Model {
  public static let metadata = ModelMeta(
    name: "Label", fields: base(["workspace": Field.reference("Workspace", key: "workspaceId"), "name": Field.property()]), syncGroup: inWorkspace)
  public override var meta: ModelMeta { Self.metadata }
  public var name: String { string("name") }
}

/// A space of the workspace with its own members, like a team.
public final class Subspace: Model {
  public static let metadata = ModelMeta(
    name: "Subspace",
    fields: base([
      "workspace": Field.reference("Workspace", key: "workspaceId"), "name": Field.property(), "description": Field.property(nullable: true),
      "visibility": Field.property(enum: ["open", "private"]), "members": Field.oneToMany("SubspaceMember", key: "subspaceId"),
    ]),
    syncGroup: { $0["visibility"]?.string == "private" ? ["subspace:\($0.id)"] : inWorkspace($0) })
  public override var meta: ModelMeta { Self.metadata }
  public var name: String { string("name") }
  public var description: String? { optionalString("description") }
  public var isPrivate: Bool { string("visibility") == "private" }
  public var members: [SubspaceMember] { children(SubspaceMember.self, key: "subspaceId") }
}

public final class SubspaceMember: Model {
  public static let metadata = ModelMeta(
    name: "SubspaceMember",
    fields: base(["subspace": Field.reference("Subspace", key: "subspaceId", indexed: true), "user": Field.reference("User", key: "userId")]),
    syncGroup: { ["subspace:\($0["subspaceId"]?.string ?? "")", "user:\($0["userId"]?.string ?? "")"] })
  public override var meta: ModelMeta { Self.metadata }
  public var userId: String { string("userId") }
  public var subspaceId: String { string("subspaceId") }
}

/// A saved query over threads: yours, or the workspace's when shared.
public final class View: Model {
  public static let metadata = ModelMeta(
    name: "View",
    fields: base([
      "owner": Field.reference("User", key: "ownerId"), "workspace": Field.reference("Workspace", key: "workspaceId"),
      "name": Field.property(), "filter": Field.property(), "shared": Field.property(),
    ]),
    syncGroup: { $0["shared"]?.bool == true ? inWorkspace($0) : ["user:\($0["ownerId"]?.string ?? "")"] })
  public override var meta: ModelMeta { Self.metadata }
  public var name: String { string("name") }
  public var filter: Filter { self.get("filter") }
  public var shared: Bool { bool("shared") }
  public var ownerId: String { string("ownerId") }
}

public final class Thread: Model {
  public static let metadata = ModelMeta(
    name: "Thread",
    fields: base([
      "title": Field.property(), "description": Field.property(nullable: true), "state": Field.property(indexed: true, enum: STATES),
      "owner": Field.reference("User", key: "ownerId", nullable: true, indexed: true), "workspace": Field.reference("Workspace", key: "workspaceId"),
      "dueAt": Field.property(nullable: true, date: true), "priority": Field.property(enum: PRIORITIES), "labelIds": Field.property(),
      "subspaceIds": Field.property(), "assigneeIds": Field.property(),
      "branchedFrom": Field.reference("Thread", key: "branchedFromId", nullable: true, indexed: true),
      "blocks": Field.reference("Thread", key: "blocksId", nullable: true, indexed: true),
      "messages": Field.oneToMany("Message", key: "threadId"), "inboxItems": Field.oneToMany("InboxItem", key: "threadId"),
      "blockers": Field.oneToMany("Thread", key: "blocksId"), "activity": Field.oneToMany("Activity", key: "threadId"),
    ]),
    syncGroup: inSubspaces)
  public override var meta: ModelMeta { Self.metadata }
  public var title: String { string("title") }
  public var description: String? { optionalString("description") }
  public var state: String { string("state") }
  public var isOpen: Bool { state != "resolved" }
  public var priority: String { string("priority") }
  public var dueAt: Date? { date("dueAt") }
  public var labelIds: [String] { strings("labelIds") }
  public var subspaceIds: [String] { strings("subspaceIds") }
  public var assigneeIds: [String] { strings("assigneeIds") }
  public var ownerId: String? { optionalString("ownerId") }
  public var workspaceId: String { string("workspaceId") }
  public var owner: User? { ref("ownerId", as: User.self) }
  public var branchedFrom: Thread? { ref("branchedFromId", as: Thread.self) }
  public var messages: [Message] { children(Message.self, key: "threadId") }
  public var inboxItems: [InboxItem] { children(InboxItem.self, key: "threadId") }
  public var activity: [Activity] { children(Activity.self, key: "threadId") }
  public var blockers: [Thread] { children(Thread.self, key: "blocksId") }
  public var branches: [Thread] { children(Thread.self, key: "branchedFromId") }
}

/// Created once, never edited. Carries its thread's `workspaceId` and `subspaceIds`, since a row computes its own group.
public final class Message: Model {
  public static let metadata = ModelMeta(
    name: "Message",
    fields: base([
      "thread": Field.reference("Thread", key: "threadId", indexed: true), "author": Field.reference("User", key: "authorId"),
      "body": Field.property(), "workspaceId": Field.property(), "subspaceIds": Field.property(),
    ]),
    syncGroup: inSubspaces)
  public override var meta: ModelMeta { Self.metadata }
  public var body: String { string("body") }
  public var authorId: String { string("authorId") }
  public var threadId: String { string("threadId") }
  public var author: User? { ref("authorId", as: User.self) }
}

/// A line in a thread saying what someone did to it. Only the server writes these.
public final class Activity: Model {
  public static let metadata = ModelMeta(
    name: "Activity",
    fields: base([
      "thread": Field.reference("Thread", key: "threadId", indexed: true), "actor": Field.reference("User", key: "actorId", nullable: true),
      "text": Field.property(), "workspaceId": Field.property(), "subspaceIds": Field.property(),
    ]),
    syncGroup: inSubspaces)
  public override var meta: ModelMeta { Self.metadata }
  public var text: String { string("text") }
  public var actor: User? { ref("actorId", as: User.self) }
}

/// One person's place for a thread in their inbox.
public final class InboxItem: Model {
  public static let metadata = ModelMeta(
    name: "InboxItem",
    fields: base([
      "user": Field.reference("User", key: "userId", indexed: true), "thread": Field.reference("Thread", key: "threadId", indexed: true),
      "bucket": Field.reference("Bucket", key: "bucketId", nullable: true, indexed: true),
      "doneAt": Field.property(nullable: true, date: true), "snoozedUntil": Field.property(nullable: true, date: true),
      "seenAt": Field.property(nullable: true, date: true), "reason": Field.property(nullable: true), "manual": Field.property(),
    ]),
    syncGroup: { ["user:\($0["userId"]?.string ?? "")"] })
  public override var meta: ModelMeta { Self.metadata }
  public var userId: String { string("userId") }
  public var threadId: String { string("threadId") }
  public var bucketId: String? { optionalString("bucketId") }
  public var doneAt: Date? { date("doneAt") }
  public var seenAt: Date? { date("seenAt") }
  public var reason: String? { optionalString("reason") }
  public var thread: Thread? { ref("threadId", as: Thread.self) }
}

/// One of a person's inbox buckets: the model sorts their inbox into them by description.
public final class Bucket: Model {
  public static let metadata = ModelMeta(
    name: "Bucket",
    fields: base([
      "user": Field.reference("User", key: "userId", indexed: true), "name": Field.property(), "description": Field.property(),
      "position": Field.property(), "items": Field.oneToMany("InboxItem", key: "bucketId"),
    ]),
    syncGroup: { ["user:\($0["userId"]?.string ?? "")"] })
  public override var meta: ModelMeta { Self.metadata }
  public var name: String { string("name") }
  public var position: Double { number("position") }
}

/// An unsent ⌘⇧N message.
public final class Draft: Model {
  public static let metadata = ModelMeta(
    name: "Draft",
    fields: base(["user": Field.reference("User", key: "userId", indexed: true), "text": Field.property(), "draft": Field.property(nullable: true)]),
    syncGroup: { ["user:\($0["userId"]?.string ?? "")"] })
  public override var meta: ModelMeta { Self.metadata }
  public var text: String { string("text") }
}

/// Registers every model, once, before a store is made.
@MainActor
public func registerThreadsModels() {
  registry.register(Workspace.metadata) { Workspace() }
  registry.register(User.metadata) { User() }
  registry.register(WorkspaceMember.metadata) { WorkspaceMember() }
  registry.register(Label.metadata) { Label() }
  registry.register(Subspace.metadata) { Subspace() }
  registry.register(SubspaceMember.metadata) { SubspaceMember() }
  registry.register(View.metadata) { View() }
  registry.register(Thread.metadata) { Thread() }
  registry.register(Message.metadata) { Message() }
  registry.register(Activity.metadata) { Activity() }
  registry.register(InboxItem.metadata) { InboxItem() }
  registry.register(Bucket.metadata) { Bucket() }
  registry.register(Draft.metadata) { Draft() }
}
