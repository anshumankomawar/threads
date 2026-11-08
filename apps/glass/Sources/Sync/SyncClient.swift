import Foundation
import Observation

public enum Connection: Sendable { case connecting, live, offline }

/// How long the socket gets to bring back a change the server confirmed.
let SOCKET_GRACE: Duration = .seconds(3)

struct Change {
  let model: String
  let modelId: String
  let data: Row?
}

/// Loads the pool, keeps it current from the socket, and tells the queue what the server confirmed
/// (packages/sync/src/sync-client.ts).
@MainActor
@Observable
public final class SyncClient {
  @ObservationIgnored public private(set) var lastSyncId = 0
  /// The sync groups the local data holds, and those followed without being in them.
  @ObservationIgnored private var holding = Meta()
  public private(set) var connection: Connection = .connecting

  @ObservationIgnored weak var core: (any Core)?
  @ObservationIgnored let queue: TransactionQueue
  @ObservationIgnored let transport: any Transport
  @ObservationIgnored let localDB: any LocalDB
  @ObservationIgnored let workspace: String
  @ObservationIgnored let token: String
  @ObservationIgnored private var lock: Task<Void, Never> = Task {}
  @ObservationIgnored private var waiters: [(id: Int, resume: CheckedContinuation<Void, Never>)] = []
  @ObservationIgnored private var attempt = 0
  @ObservationIgnored private var socket: (any SocketHandle)?

  init(core: any Core, queue: TransactionQueue, transport: any Transport, localDB: any LocalDB, workspace: String, token: String) {
    self.core = core
    self.queue = queue
    self.transport = transport
    self.localDB = localDB
    self.workspace = workspace
    self.token = token
  }

  public func bootstrap() async {
    if await localDB.open(workspace: workspace, schemaHash: registry.schemaHash) == .fresh {
      var attempt = 0
      while true {
        do { try await full(); return } catch {
          try? await Task.sleep(for: backoff(attempt))
          attempt += 1
        }
      }
    }
    var loaded: [SyncAction] = []
    for meta in registry.all() {
      for row in await localDB.load(meta.name) { loaded.append(.insert(meta.name, row)) }
    }
    let meta = await localDB.metaGet()
    holding = Meta(groups: meta.groups, subscribed: meta.subscribed)
    update(loaded.map { Change(model: $0.model, modelId: $0.modelId, data: $0.data) }, meta.lastSyncId)
    await queue.replayOutbox()
    // Offline, the socket's Hello catches up once it connects. A server behind this cache has started over.
    if let packet = try? await transport.deltas(after: lastSyncId, subscribed: holding.subscribed) {
      if packet.lastSyncId < lastSyncId { await locked { try? await self.full() } }
      else { await applyDelta(packet) }
    }
  }

  public func connect() {
    connection = .connecting
    var failed = false
    var handle: (any SocketHandle)?
    handle = transport.connect(
      hello: { [weak self] in
        guard let self else { return Hello(lastSyncId: 0, token: "", subscribed: []) }
        attempt = 0
        connection = .live
        return Hello(lastSyncId: lastSyncId, token: token, subscribed: holding.subscribed)
      },
      // A step that fails can't be skipped: what came after it waits for a new Hello.
      // Queued on the lock at once, in the order packets arrive, so `settled()` after a message waits for its apply.
      onMessage: { [weak self] packet in
        guard let self else { return }
        self.chain {
          if failed { return }
          do { try await self.apply(packet) } catch {
            failed = true
            handle?.close()
          }
        }
      },
      onClose: { [weak self] in
        guard let self else { return }
        connection = .offline
        let delay = backoff(attempt)
        attempt += 1
        Task {
          try? await Task.sleep(for: delay)
          _ = await self.lock.value
          self.connect()
        }
      })
    socket = handle
  }

  /// Follows a group the session may read without being in it: the next Hello asks for it.
  public func subscribe(_ group: String) {
    if holding.subscribed.contains(group) { return }
    holding.subscribed.append(group)
    Task {
      await self.locked {
        await self.localDB.metaSet(Meta(lastSyncId: self.lastSyncId, groups: self.holding.groups, subscribed: self.holding.subscribed))
        self.socket?.hello()
      }
    }
  }

  /// After everything the socket has handed over so far has been applied.
  public func settled() async { await locked {} }

  public func applyDelta(_ packet: DeltasResponse) async {
    await locked { try? await self.apply(packet) }
  }

  public func waitForSyncId(_ id: Int) async {
    if id <= lastSyncId { return }
    // A socket can look open and deliver nothing. A confirmed change that hasn't come back says so: connect again.
    Task {
      try? await Task.sleep(for: SOCKET_GRACE)
      if id > self.lastSyncId { self.socket?.close() }
    }
    await withCheckedContinuation { waiters.append((id, $0)) }
  }

  /// Runs `work` after everything chained before it; the chain itself is extended synchronously.
  @discardableResult
  private func chain(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
    let previous = lock
    let run = Task { @MainActor in
      _ = await previous.value
      await work()
    }
    lock = run
    return run
  }

  private func locked(_ work: @escaping @MainActor () async -> Void) async {
    _ = await chain(work).value
  }

  /// A packet older than this client's position is behind it. One whose groups differ from what the local data holds
  /// changes those first, which also brings everything up to now.
  private func apply(_ packet: DeltasResponse) async throws {
    if packet.lastSyncId < lastSyncId { return }
    if Set(packet.groups) != Set(holding.groups) { return try await regroup() }
    var actions = packet.actions.filter { $0.id > lastSyncId }
    var end = packet.lastSyncId
    // Ids filtered out by sync groups look like gaps too; the fetch confirms nothing visible is missing.
    if let first = actions.first, first.id != lastSyncId + 1 {
      let fetched = try await transport.deltas(after: lastSyncId, subscribed: holding.subscribed)
      if Set(fetched.groups) != Set(holding.groups) { return try await regroup() }
      actions = fetched.actions
      end = fetched.lastSyncId
    }
    if end == lastSyncId { return }
    await localDB.write(actions)
    await localDB.metaSet(Meta(lastSyncId: end, groups: holding.groups, subscribed: holding.subscribed))
    update(actions.map { Change(model: $0.model, modelId: $0.modelId, data: $0.data) }, end)
  }

  /// The session's groups changed: the server answers as of one sync id with its groups, the rows of those this
  /// client doesn't hold, and every action since this client's position.
  private func regroup() async throws {
    let (rows, end) = try await transport.bootstrap(subscribed: holding.subscribed, partial: (holding.groups, lastSyncId))
    var gone: [SyncAction] = []
    for meta in registry.all() {
      for row in await localDB.load(meta.name) where !sees(end.groups, meta.syncGroup?(row) ?? []) {
        gone.append(SyncAction(id: 0, txId: "", model: meta.name, modelId: row.id, action: "D", data: nil))
      }
    }
    let changes = gone + end.actions.filter { $0.id > lastSyncId } + rows.map { SyncAction.insert($0.model, $0.row) }
    let last = max(lastSyncId, end.lastSyncId)
    holding.groups = end.groups
    await localDB.write(changes)
    await localDB.metaSet(Meta(lastSyncId: last, groups: holding.groups, subscribed: holding.subscribed))
    update(changes.map { Change(model: $0.model, modelId: $0.modelId, data: $0.data) }, last)
  }

  /// A full load: everything the server holds for this session replaces local data. The outbox stays.
  private func full() async throws {
    let (rows, end) = try await transport.bootstrap(subscribed: holding.subscribed, partial: nil)
    let inserts = rows.map { SyncAction.insert($0.model, $0.row) }
    holding.groups = end.groups
    await localDB.wipe()
    await localDB.write(inserts)
    await localDB.metaSet(Meta(lastSyncId: end.lastSyncId, groups: holding.groups, subscribed: holding.subscribed))
    let kept = Set(rows.map(\.row.id))
    guard let core else { return }
    // A local create the server hasn't confirmed isn't the server's to remove.
    let removed = core.pool.allIds().filter { !kept.contains($0) && (core.pool.get($0)?.isPersisted ?? false) }
      .map { Change(model: core.pool.get($0)!.meta.name, modelId: $0, data: nil) }
    update(inserts.map { Change(model: $0.model, modelId: $0.modelId, data: $0.data) } + removed, end.lastSyncId)
  }

  /// Server rows into the pool, then pending transactions and unsaved edits back on top, then the new position.
  private func update(_ changes: [Change], _ last: Int) {
    guard let core else { return }
    var unsaved: [String: [(String, JSON)]] = [:]
    for change in changes {
      let model = core.pool.get(change.modelId)
      if let model, unsaved[change.modelId] == nil {
        unsaved[change.modelId] = model.changedFields.map { ($0, model.data[$0] ?? .null) }
      }
      guard let data = change.data else { core.pool.remove(change.modelId); continue }
      if let model {
        for (field, value) in data { model.write(field, value) }
        model.persisted = true
      } else {
        let fresh = core.materialize(change.model, data)
        fresh.persisted = true
        core.pool.put(fresh)
      }
    }
    for modelId in Set(changes.map(\.modelId)) {
      queue.onDelta(modelId, last)
      if let model = core.pool.get(modelId) {
        for (field, value) in unsaved[modelId] ?? [] {
          model.original[field] = model.data[field] ?? .null
          model.write(field, value)
        }
      }
    }
    lastSyncId = last
    let ready = waiters.filter { $0.id <= last }
    waiters.removeAll { $0.id <= last }
    for w in ready { w.resume.resume() }
  }
}
