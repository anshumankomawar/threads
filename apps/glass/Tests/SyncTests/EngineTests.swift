import Foundation
import Testing
@testable import Sync

// The engine against a fake server (packages/testing's World, in miniature): the queue's rules, rollback, and the sync
// client's apply order. `LiveTests` runs the same store against the local API when it's up.

/// A server with one sync-action log, numbering every change, answering the spec's endpoints.
@MainActor
final class FakeServer: Transport {
  var rows: [String: [String: Row]] = [:]
  var log: [SyncAction] = []
  var groups = ["workspace:w", "user:me"]
  var refuse: (TxRecord) -> String? = { _ in nil }
  var failNext = false
  var sockets: [(hello: () -> Hello, onMessage: (DeltasResponse) -> Void, onClose: () -> Void)] = []
  var mutateCalls: [[String]] = []

  var lastSyncId: Int { log.last?.id ?? 0 }

  func bootstrap(subscribed: [String], partial: (holds: [String], after: Int)?) async throws -> (rows: [BootstrapLine], end: BootstrapEnd) {
    let lines = rows.flatMap { model, table in table.values.map { BootstrapLine(model: model, row: $0) } }
    let actions = partial.map { p in log.filter { $0.id > p.after } } ?? []
    return (lines, BootstrapEnd(lastSyncId: lastSyncId, schemaHash: "x", groups: groups, actions: actions))
  }

  func deltas(after: Int, subscribed: [String]) async throws -> DeltasResponse {
    DeltasResponse(actions: log.filter { $0.id > after }, lastSyncId: lastSyncId, groups: groups)
  }

  func mutate(_ request: MutateRequest) async throws -> MutateResponse {
    if failNext { failNext = false; throw URLError(.notConnectedToInternet) }
    mutateCalls.append(request.transactions.map(\.id))
    var results: [MutateResult] = []
    var produced: [SyncAction] = []
    for tx in request.transactions {
      if let why = refuse(tx) { results.append(MutateResult(txId: tx.id, ok: false, syncId: nil, code: "forbidden", message: why)); continue }
      var row = rows[tx.model]?[tx.modelId] ?? [:]
      let code: String
      switch tx.kind {
      case .create: row = tx.changes ?? [:]; code = "I"
      case .update: for (k, v) in tx.changes ?? [:] { row[k] = v }; code = "U"
      case .archive: row["archivedAt"] = tx.changes?["archivedAt"] ?? .null; code = "A"
      case .unarchive: row["archivedAt"] = .null; code = "R"
      case .delete: code = "D"
      }
      if tx.kind == .delete { rows[tx.model]?.removeValue(forKey: tx.modelId) } else { rows[tx.model, default: [:]][tx.modelId] = row }
      let action = SyncAction(id: lastSyncId + 1, txId: tx.id, model: tx.model, modelId: tx.modelId, action: code, data: tx.kind == .delete ? nil : row)
      log.append(action)
      produced.append(action)
      results.append(MutateResult(txId: tx.id, ok: true, syncId: action.id, code: nil, message: nil))
    }
    // Broadcast, as the Durable Object does after a commit.
    if !produced.isEmpty { broadcast(produced) }
    return MutateResponse(results: results)
  }

  func broadcast(_ actions: [SyncAction]) {
    let packet = DeltasResponse(actions: actions, lastSyncId: lastSyncId, groups: groups)
    for s in sockets { s.onMessage(packet) }
  }

  /// Another client's change.
  func external(_ model: String, _ row: Row, action: String = "U") {
    rows[model, default: [:]][row.id] = row
    let a = SyncAction(id: lastSyncId + 1, txId: UUID().uuidString, model: model, modelId: row.id, action: action, data: row)
    log.append(a)
    broadcast([a])
  }

  func action(_ name: String, _ args: JSON) async throws -> ActionResponse { ActionResponse(lastSyncId: lastSyncId) }

  func connect(hello: @escaping () -> Hello, onMessage: @escaping (DeltasResponse) -> Void, onClose: @escaping () -> Void) -> any SocketHandle {
    sockets.append((hello, onMessage, onClose))
    _ = hello()
    return FakeSocket()
  }
}

@MainActor final class FakeSocket: SocketHandle {
  func close() {}
  func hello() {}
}

@MainActor
private func makeStore(_ server: FakeServer) async -> Store {
  registerThreadsModels()
  let store = Store(transport: server, localDB: MemoryLocalDB(), workspace: "w", token: "me")
  await store.ready()
  return store
}

private func thread(_ id: String, title: String) -> Row {
  ["id": .string(id), "title": .string(title), "state": .string("open"), "priority": .string("none"), "workspaceId": .string("w"),
   "labelIds": .array([]), "subspaceIds": .array([]), "assigneeIds": .array([]), "ownerId": .string("me"),
   "createdAt": .number(1), "updatedAt": .number(1), "archivedAt": .null]
}

@Suite(.serialized) @MainActor
struct EngineTests {
  @Test func bootstrapsRowsIntoThePool() async {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "First")]
    let store = await makeStore(server)
    #expect(store.find(Thread.self, "t1")?.title == "First")
    #expect(store.all(Thread.self).count == 1)
    #expect(store.sync.lastSyncId == 0)
  }

  @Test func anEditIsOptimisticThenConfirmedBySyncId() async throws {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "First")]
    let store = await makeStore(server)
    let t = store.find(Thread.self, "t1")!
    t.set("title", .string("Renamed"))
    #expect(t.title == "Renamed")  // at once
    #expect(t.changedFields == ["title"])
    let tx = t.save()
    #expect(store.pendingCount == 1)
    try await tx.result()
    #expect(tx.status == .done)
    #expect(store.pendingCount == 0)
    #expect(server.rows["Thread"]?["t1"]?["title"]?.string == "Renamed")
    #expect(store.sync.lastSyncId == 1)
  }

  @Test func aRejectedEditRollsBack() async {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "First")]
    server.refuse = { $0.kind == .update ? "not yours" : nil }
    let store = await makeStore(server)
    let t = store.find(Thread.self, "t1")!
    t.set("title", .string("Nope"))
    let tx = t.save()
    await #expect(throws: RejectedError.self) { try await tx.result() }
    #expect(t.title == "First")
    #expect(store.rejection == "not yours")
  }

  @Test func aCreateArrivesAndIsPersisted() async throws {
    let server = FakeServer()
    let store = await makeStore(server)
    let t = store.create(Thread.self, thread("", title: "New").filter { $0.key != "id" })
    #expect(t.isPersisted == false)
    #expect(store.all(Thread.self).count == 1)
    try await store.queue.entriesForTest.first!.tx.result()
    #expect(t.isPersisted == true)
    #expect(server.rows["Thread"]?[t.id]?["title"]?.string == "New")
  }

  @Test func relatedTransactionsGoInSeparateRequests() async throws {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "A"), "t2": thread("t2", title: "B")]
    let store = await makeStore(server)
    let a = store.find(Thread.self, "t1")!, b = store.find(Thread.self, "t2")!
    a.set("title", .string("A2")); let tx1 = a.save()
    a.set("title", .string("A3")); let tx2 = a.save()
    b.set("title", .string("B2")); let tx3 = b.save()
    try await tx1.result(); try await tx2.result(); try await tx3.result()
    // The two edits of t1 never share a request; t2's may ride with the first.
    for call in server.mutateCalls { #expect(!(call.contains(tx1.id) && call.contains(tx2.id))) }
    #expect(a.title == "A3")
    #expect(server.rows["Thread"]?["t1"]?["title"]?.string == "A3")
  }

  @Test func aNetworkErrorRetriesWithoutLosingTheEdit() async throws {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "First")]
    let store = await makeStore(server)
    server.failNext = true
    let t = store.find(Thread.self, "t1")!
    t.set("title", .string("Eventually"))
    let tx = t.save()
    try await tx.result()
    #expect(server.rows["Thread"]?["t1"]?["title"]?.string == "Eventually")
  }

  @Test func anotherClientsChangeAppliesAndRebasesPendingEdits() async throws {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "First")]
    let store = await makeStore(server)
    let t = store.find(Thread.self, "t1")!
    // An unsaved local edit survives a server change to another field.
    t.set("title", .string("Mine"))
    var row = server.rows["Thread"]!["t1"]!
    row["priority"] = .string("high")
    server.external("Thread", row)
    await store.sync.settled()
    #expect(t.priority == "high")
    #expect(t.title == "Mine")
    #expect(t.changedFields == ["title"])
    #expect(store.sync.lastSyncId == 1)
  }

  @Test func aGapIsFilledFromDeltas() async {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "First")]
    let store = await makeStore(server)
    // Two external changes; only the second's packet is delivered, so the client must fetch the first.
    var r1 = server.rows["Thread"]!["t1"]!; r1["title"] = .string("One")
    server.rows["Thread"]!["t1"] = r1
    server.log.append(SyncAction(id: 1, txId: "x", model: "Thread", modelId: "t1", action: "U", data: r1))
    var r2 = r1; r2["title"] = .string("Two")
    server.external("Thread", r2)
    await store.sync.settled()
    #expect(store.find(Thread.self, "t1")?.title == "Two")
    #expect(store.sync.lastSyncId == 2)
  }

  @Test func filterMatchesLikeTheClient() async {
    let server = FakeServer()
    server.rows["Thread"] = ["t1": thread("t1", title: "First")]
    let store = await makeStore(server)
    let t = store.find(Thread.self, "t1")!
    let mine: Filter = .object(["or": .array([.object(["ownerId": .object(["eq": .string("$me")])]), .object(["assigneeIds": .object(["contains": .string("$me")])])])])
    #expect(matches(t, mine, variables: ["me": .string("me")]))
    #expect(!matches(t, mine, variables: ["me": .string("someone")]))
    #expect(matches(t, .object(["labelIds": .object(["null": .bool(true)])])))
  }

  @Test func textTokensSplit() {
    let parts = splitText("Hi [[person:u1]], see [[thread:t9]] by [[date:0]].")
    #expect(parts.count == 7)
    #expect(mentionsIn("[[person:a]] and [[person:b]]") == ["a", "b"])
    #expect(plainText("[[person:u1]] ok", titleOf: { _ in nil }, nameOf: { $0 == "u1" ? "Sam" : nil }) == "@Sam ok")
  }
}

/// Against the local API, when it's running (`vp run api#dev`); skipped otherwise.
@Suite(.serialized) @MainActor
struct LiveTests {
  @Test func roundTripsAMessageThroughTheLocalAPI() async throws {
    let url = URL(string: "http://127.0.0.1:3030")!
    var probe = URLRequest(url: url.appendingPathComponent("/sync/deltas"))
    probe.timeoutInterval = 2
    probe.setValue("sample", forHTTPHeaderField: "X-Workspace")
    guard let (_, response) = try? await URLSession.shared.data(for: probe), (response as? HTTPURLResponse)?.statusCode == 200 else {
      return  // no local API: nothing to test against
    }
    registerThreadsModels()
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("arc-glass-test-\(UUID().uuidString)")
    let store = Store(transport: HTTPTransport(url: url, workspace: "sample", token: "you"), localDB: SQLiteLocalDB(directory: dir, models: registry.all().map(\.name)), workspace: "sample", token: "you")
    await store.ready()
    #expect(store.all(Thread.self).count > 0)
    let thread = store.all(Thread.self).first { $0.isOpen && $0.ownerId == "you" } ?? store.all(Thread.self)[0]
    let before = thread.messages.count
    let body = "Round trip from the Swift engine at \(Date().formatted(.dateTime.hour().minute().second()))"
    let m = store.create(Message.self, [
      "threadId": .string(thread.id), "authorId": .string("you"), "body": .string(body),
      "workspaceId": .string(thread.workspaceId), "subspaceIds": .strings(thread.subspaceIds),
    ])
    #expect(thread.messages.count == before + 1)  // optimistic
    try await store.queue.entriesForTest.first { $0.record.modelId == m.id }!.tx.result()
    #expect(m.isPersisted)
    // And the server has it.
    var check = URLRequest(url: URL(string: "/sync/deltas?after=\(store.sync.lastSyncId - 5)&subscribed=", relativeTo: url)!)
    check.setValue("sample", forHTTPHeaderField: "X-Workspace")
    check.setValue("Bearer you", forHTTPHeaderField: "Authorization")
    let (data, _) = try await URLSession.shared.data(for: check)
    let deltas = try JSONDecoder().decode(DeltasResponse.self, from: data)
    #expect(deltas.actions.contains { $0.modelId == m.id && $0.data?["body"]?.string == body })
    try? FileManager.default.removeItem(at: dir)
  }
}
