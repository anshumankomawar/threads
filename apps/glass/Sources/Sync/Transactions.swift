import Foundation
import Observation

public enum TxStatus: Sendable { case queued, sending, awaitingSync, done, rejected }

/// One edit on its way to the server: its id is the idempotency key; `result()` resolves when its own sync id is back.
@MainActor
public final class Transaction {
  public let id: String
  public internal(set) var status: TxStatus = .queued
  private var waiters: [CheckedContinuation<Void, Error>] = []
  private var outcome: Result<Void, Error>?

  init(id: String) { self.id = id }

  static func settled() -> Transaction {
    let t = Transaction(id: UUID().uuidString)
    t.settle(nil)
    return t
  }

  func settle(_ error: Error?) {
    status = error == nil ? .done : .rejected
    outcome = error.map { .failure($0) } ?? .success(())
    for w in waiters { w.resume(with: outcome!) }
    waiters = []
  }

  public func result() async throws {
    if let outcome { return try outcome.get() }
    try await withCheckedThrowingContinuation { waiters.append($0) }
  }
}

/// A request the server refused (4xx): its transaction rolls back. Anything else thrown is a network error: retried.
public struct RejectedError: Error, Sendable { public let message: String }

/// 1s doubling to 10s, for resending and reconnecting.
public func backoff(_ attempt: Int) -> Duration { .milliseconds(min(1000 * (1 << min(attempt, 10)), 10_000)) }

let PER_REQUEST = 40

/// The ids a transaction references, so it isn't sent alongside a transaction for one of them.
@MainActor
private func references(_ record: TxRecord) -> Set<String> {
  var ids = Set<String>()
  for (_, field) in registry.meta(record.model).fields where field.kind == .reference {
    if let k = field.foreignKey {
      if let s = record.original?[k]?.string { ids.insert(s) }
      if let s = record.changes?[k]?.string { ids.insert(s) }
    }
  }
  return ids
}

@MainActor
private func related(_ a: TxRecord, _ b: TxRecord) -> Bool {
  a.modelId == b.modelId || references(a).contains(b.modelId) || references(b).contains(a.modelId)
}

/// Takes each transaction from the setter that made it to the sync id that confirms it, one request at a time
/// (packages/sync/src/transactions.ts). Rules from Linear's queue: save to the outbox before sending; send in order;
/// never two for one model (or a model and one it references) in a request; at most 40 a request; a network error puts
/// the batch back at the front; a rejection rolls back; done only when lastSyncId reaches its sync id.
@MainActor
@Observable
public final class TransactionQueue {
  final class Entry {
    var record: TxRecord
    let tx: Transaction
    var saved: Bool
    var syncId: Int?
    init(record: TxRecord, tx: Transaction, saved: Bool) { self.record = record; self.tx = tx; self.saved = saved }
  }

  @ObservationIgnored var batch = 0
  public private(set) var pendingCount = 0
  /// Why the server last refused a change, which has already been undone.
  public var rejection: String?

  @ObservationIgnored weak var core: (any Core)?
  @ObservationIgnored let localDB: any LocalDB
  @ObservationIgnored let transport: any Transport
  @ObservationIgnored let waitForSyncId: (Int) async -> Void
  @ObservationIgnored let lastSyncId: () -> Int
  @ObservationIgnored private var entries: [Entry] = []
  /// The queue's entries, for the tests.
  var entriesForTest: [Entry] { entries }
  @ObservationIgnored private var created: [Entry] = []
  @ObservationIgnored private var busy = false
  @ObservationIgnored private var attempt = 0
  @ObservationIgnored private var flushScheduled = false

  init(core: any Core, localDB: any LocalDB, transport: any Transport, waitForSyncId: @escaping (Int) async -> Void, lastSyncId: @escaping () -> Int) {
    self.core = core
    self.localDB = localDB
    self.transport = transport
    self.waitForSyncId = waitForSyncId
    self.lastSyncId = lastSyncId
  }

  func enqueue(_ record: TxRecord) -> Transaction {
    let entry = Entry(record: record, tx: Transaction(id: record.id), saved: false)
    add(entry)
    created.append(entry)
    if !flushScheduled {
      flushScheduled = true
      Task { await self.flush() }
    }
    return entry.tx
  }

  func onDelta(_ modelId: String, _ lastSyncId: Int) {
    for e in entries where e.record.modelId == modelId && !(e.syncId.map { $0 <= lastSyncId } ?? false) {
      apply(e)
    }
  }

  func replayOutbox() async {
    let records = await localDB.outboxAll()
    for record in records {
      let e = Entry(record: record, tx: Transaction(id: record.id), saved: true)
      add(e)
      apply(e)
      batch = max(batch, record.batch + 1)
    }
    pump()
  }

  private func add(_ e: Entry) {
    entries.append(e)
    pendingCount = entries.count
  }

  /// The end of the tick: this tick's transactions are one batch, saved before they're sent.
  private func flush() async {
    flushScheduled = false
    let mine = created.filter { e in entries.contains { $0 === e } }
    created = []
    batch += 1
    await localDB.outboxPut(mine.map(\.record))
    for e in mine { e.saved = true }
    pump()
  }

  /// Sends the queued transactions in order, up to the first that's unsaved or related to one already in the request.
  private func pump() {
    if busy { return }
    var request: [Entry] = []
    for e in entries {
      if e.tx.status != .queued { continue }
      if !e.saved || request.count == PER_REQUEST || request.contains(where: { related($0.record, e.record) }) { break }
      request.append(e)
    }
    if !request.isEmpty { Task { await self.send(request) } }
  }

  private func send(_ request: [Entry]) async {
    busy = true
    for e in request { e.tx.status = .sending }
    do {
      let response = try await transport.mutate(MutateRequest(transactions: request.map(\.record)))
      for result in response.results {
        guard let e = request.first(where: { $0.record.id == result.txId }) else { continue }
        if result.ok, let syncId = result.syncId { confirm(e, syncId) }
        else { await reject(e, RejectedError(message: result.message ?? "refused")) }
      }
    } catch let error as RejectedError {
      for e in request { await reject(e, error) }
    } catch {
      for e in request { e.tx.status = .queued }
      let delay = backoff(attempt)
      attempt += 1
      Task { [weak self] in
        try? await Task.sleep(for: delay)
        self?.busy = false
        self?.pump()
      }
      return
    }
    attempt = 0
    busy = false
    pump()
  }

  private func confirm(_ e: Entry, _ syncId: Int) {
    let (kind, modelId) = (e.record.kind, e.record.modelId)
    e.syncId = syncId
    e.tx.status = .awaitingSync
    // Its own change already came back, and rebasing put the transaction on top of it again: take that off.
    if syncId <= lastSyncId() && kind != .create && kind != .delete { Task { await self.rollback(e.record) } }
    Task { [weak self] in
      guard let self else { return }
      await self.waitForSyncId(syncId)
      guard let core = self.core else { return }
      // A creation the server didn't send back is one this client can't see.
      if kind == .create, !(core.pool.get(modelId)?.isPersisted ?? false) { core.pool.remove(modelId) }
      await self.finish(e, nil)
    }
  }

  private func reject(_ e: Entry, _ error: RejectedError) async {
    rejection = error.message
    await rollback(e.record)
    // What waits on a refused creation goes with it: undoing it would bring back a model that never existed.
    if e.record.kind == .create {
      for later in entries where later !== e && later.record.modelId == e.record.modelId { await finish(later, error) }
    }
    await finish(e, error)
  }

  private func finish(_ e: Entry, _ error: Error?) async {
    entries.removeAll { $0 === e }
    pendingCount = entries.count
    await localDB.outboxRemove(e.record.id)
    e.tx.settle(error)
  }

  /// (Re)applies a transaction on top of what the pool holds now, which becomes its `original`. The server's copy of a
  /// model wins over a pending create of it.
  private func apply(_ e: Entry) {
    guard let core else { return }
    let model = core.pool.get(e.record.modelId)
    switch e.record.kind {
    case .create:
      if model == nil { core.pool.put(core.materialize(e.record.model, e.record.changes ?? [:])) }
    case .delete:
      guard let model else { return }
      e.record.original = model.data
      core.pool.remove(model.id)
    default:
      guard let model else { return }
      var original: Row = [:]
      for (field, value) in e.record.changes ?? [:] {
        original[field] = model.data[field] ?? .null
        model.write(field, value)
      }
      e.record.original = original
    }
  }

  /// Undoes a rejected transaction, leaving any field edited since as it is. A deleted model comes back as the server
  /// last sent it, if this client may still see it.
  private func rollback(_ record: TxRecord) async {
    guard let core else { return }
    if record.kind == .delete {
      let rows = await localDB.load(record.model)
      guard let row = rows.first(where: { $0.id == record.modelId }), core.pool.get(record.modelId) == nil else { return }
      let model = core.materialize(record.model, row)
      model.persisted = true
      core.pool.put(model)
      return
    }
    let model = core.pool.get(record.modelId)
    if record.kind == .create { core.pool.remove(record.modelId); return }
    guard let model else { return }
    // Edits made on top of it, saved or not, now undo to what was there before it.
    let at = entries.firstIndex { $0.record.id == record.id } ?? entries.count
    var above: [Row] = [model.original]
    for later in entries.dropFirst(at + 1) where later.record.modelId == record.modelId {
      if let o = later.record.original { above.append(o) }
    }
    for (field, value) in record.original ?? [:] {
      let rejected = record.changes?[field] ?? .null
      if (model.data[field] ?? .null) == rejected { model.write(field, value) }
      for i in above.indices where above[i][field] != nil && above[i][field] == rejected { above[i][field] = value }
    }
    model.original = above[0]
    var n = 1
    for later in entries.dropFirst(at + 1) where later.record.modelId == record.modelId {
      if later.record.original != nil { later.record.original = above[n]; n += 1 }
    }
  }
}
