import Foundation
import Observation

/// The developer API (spec, "The store"): create, find, list, and the connection's state. Starts loading at once, from
/// the local database when it has this workspace, else from the server; then connects.
@MainActor
@Observable
public final class Store: Core {
  public let pool = ObjectPool()
  @ObservationIgnored private(set) var queue: TransactionQueue!
  @ObservationIgnored private(set) var sync: SyncClient!
  @ObservationIgnored private var readyTask: Task<Void, Never>!

  public init(transport: any Transport, localDB: any LocalDB, workspace: String, token: String) {
    // The queue and the sync client each need the other; both read it through `self`, after both exist.
    queue = TransactionQueue(core: self, localDB: localDB, transport: transport,
      waitForSyncId: { [weak self] id in await self?.sync.waitForSyncId(id) },
      lastSyncId: { [weak self] in self?.sync.lastSyncId ?? 0 })
    sync = SyncClient(core: self, queue: queue, transport: transport, localDB: localDB, workspace: workspace, token: token)
    readyTask = Task { @MainActor [sync] in
      await sync!.bootstrap()
      sync!.connect()
    }
  }

  // MARK: Core

  public func materialize(_ model: String, _ row: Row) -> Model {
    let m = registry.make(model)
    m.data = row
    m.store = self
    return m
  }

  public func enqueue(_ kind: TxKind, _ model: Model, changes: Row?, original: Row?) -> Transaction {
    queue.enqueue(TxRecord(id: UUID().uuidString.lowercased(), kind: kind, model: model.meta.name, modelId: model.id, changes: changes, original: original, batch: queue.batch))
  }

  // MARK: Store

  /// A new model, in the pool at once and on its way to the server. `fields` are stored values (ids for references).
  @discardableResult
  public func create<T: Model>(_ type: T.Type, _ fields: Row) -> T {
    var row = fields
    let now = JSON.date(Date())
    row["id"] = .string(UUID().uuidString.lowercased())
    row["createdAt"] = now
    row["updatedAt"] = now
    row["archivedAt"] = .null
    let model = materialize(type.init().meta.name, row) as! T
    pool.put(model)
    _ = enqueue(.create, model, changes: row, original: nil)
    return model
  }

  public func find<T: Model>(_ type: T.Type, _ id: String) -> T? { pool.get(id) as? T }

  public func all<T: Model>(_ type: T.Type, includeArchived: Bool = false) -> [T] {
    let list = pool.all(type.init().meta.name).compactMap { $0 as? T }
    return includeArchived ? list : list.filter { $0.archivedAt == nil }
  }

  public func `where`<T: Model>(_ type: T.Type, _ field: String, _ value: JSON) -> [T] {
    pool.byIndex(type.init().meta.name, field, value).compactMap { $0 as? T }.filter { $0.archivedAt == nil }
  }

  public func action(_ name: String, _ args: JSON) async throws {
    let response = try await sync.transport.action(name, args)
    await sync.waitForSyncId(response.lastSyncId)
  }

  public func subscribe(_ group: String) { sync.subscribe(group) }

  public var connection: Connection { sync.connection }
  public var pendingCount: Int { queue.pendingCount }
  public var rejection: String? { queue.rejection }
  public func dismissRejection() { queue.rejection = nil }
  public func ready() async { await readyTask.value }
}
