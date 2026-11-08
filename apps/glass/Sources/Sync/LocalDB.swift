import Foundation
import SQLite3

/// Where the local data is up to: its sync id, the sync groups it holds, and those it follows without being in them.
public struct Meta: Codable, Sendable, Equatable {
  public var lastSyncId: Int
  public var groups: [String]
  public var subscribed: [String]
  public init(lastSyncId: Int = 0, groups: [String] = [], subscribed: [String] = []) {
    self.lastSyncId = lastSyncId
    self.groups = groups
    self.subscribed = subscribed
  }
}

/// The local database: server-approved rows per model, `_meta`, and the `_outbox` (packages/sync/src/local-db.ts).
public protocol LocalDB: Sendable {
  func open(workspace: String, schemaHash: String) async -> OpenResult
  func load(_ model: String) async -> [Row]
  func write(_ actions: [SyncAction]) async  // server-approved data only
  func metaGet() async -> Meta
  func metaSet(_ meta: Meta) async
  func outboxPut(_ txs: [TxRecord]) async
  func outboxRemove(_ id: String) async
  func outboxAll() async -> [TxRecord]
  func wipe() async
}

public enum OpenResult: Sendable { case fresh, existing }

/// One SQLite file per workspace: a table per model (id, data as JSON), `_meta` (one row), `_outbox` (in the order it
/// was saved). All on one serial actor, as IndexedDB's transactions are.
public actor SQLiteLocalDB: LocalDB {
  private var db: OpaquePointer?
  private var schemaHash = ""
  private let directory: URL
  private let tables: [String]
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  /// `models` are the registered models' names: one table each.
  public init(directory: URL, models: [String]) {
    self.directory = directory
    self.tables = models
  }

  private func models() -> [String] { tables }
  private func quote(_ name: String) -> String { "\"\(name.replacingOccurrences(of: "\"", with: "\"\""))\"" }

  private func exec(_ sql: String) {
    var err: UnsafeMutablePointer<CChar>?
    if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
      let message = err.map { String(cString: $0) } ?? "?"
      sqlite3_free(err)
      assertionFailure("sqlite: \(message) in \(sql)")
    }
  }

  private func query(_ sql: String, bind: [String] = [], row: (OpaquePointer) -> Void) {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
    defer { sqlite3_finalize(stmt) }
    for (i, value) in bind.enumerated() { sqlite3_bind_text(stmt, Int32(i + 1), value, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
    while sqlite3_step(stmt) == SQLITE_ROW { row(stmt!) }
  }

  private func run(_ sql: String, bind: [String?]) {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
    defer { sqlite3_finalize(stmt) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (i, value) in bind.enumerated() {
      if let value { sqlite3_bind_text(stmt, Int32(i + 1), value, -1, transient) } else { sqlite3_bind_null(stmt, Int32(i + 1)) }
    }
    sqlite3_step(stmt)
  }

  private func text(_ stmt: OpaquePointer, _ col: Int32) -> String? {
    sqlite3_column_text(stmt, col).map { String(cString: $0) }
  }

  public func open(workspace: String, schemaHash hash: String) async -> OpenResult {
    schemaHash = hash
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = directory.appendingPathComponent("sync-\(workspace).sqlite").path
    if db != nil { sqlite3_close(db) }
    sqlite3_open(file, &db)
    exec("pragma journal_mode=wal")
    for model in models() { exec("create table if not exists \(quote(model)) (id text primary key, data text not null)") }
    exec("create table if not exists _meta (key text primary key, value text not null)")
    exec("create table if not exists _outbox (seq integer primary key autoincrement, id text not null, record text not null)")
    var stored: String?
    query("select value from _meta where key = 'schemaHash'") { stored = self.text($0, 0) }
    if stored == hash { return .existing }
    await wipe()
    exec("delete from _outbox")
    return .fresh
  }

  public func load(_ model: String) async -> [Row] {
    var rows: [Row] = []
    query("select data from \(quote(model))") { stmt in
      if let s = self.text(stmt, 0), let d = s.data(using: .utf8), let row = try? self.decoder.decode(Row.self, from: d) { rows.append(row) }
    }
    return rows
  }

  public func write(_ actions: [SyncAction]) async {
    if actions.isEmpty { return }
    exec("begin")
    for a in actions {
      if let data = a.data, let json = try? encoder.encode(data), let s = String(data: json, encoding: .utf8) {
        run("insert or replace into \(quote(a.model)) (id, data) values (?, ?)", bind: [a.modelId, s])
      } else {
        run("delete from \(quote(a.model)) where id = ?", bind: [a.modelId])
      }
    }
    exec("commit")
  }

  public func metaGet() async -> Meta {
    var meta = Meta()
    query("select value from _meta where key = 'meta'") { stmt in
      if let s = self.text(stmt, 0), let d = s.data(using: .utf8), let m = try? self.decoder.decode(Meta.self, from: d) { meta = m }
    }
    return meta
  }

  public func metaSet(_ meta: Meta) async {
    guard let json = try? encoder.encode(meta), let s = String(data: json, encoding: .utf8) else { return }
    run("insert or replace into _meta (key, value) values ('meta', ?)", bind: [s])
    run("insert or replace into _meta (key, value) values ('schemaHash', ?)", bind: [schemaHash])
  }

  public func outboxPut(_ txs: [TxRecord]) async {
    exec("begin")
    for tx in txs {
      if let json = try? encoder.encode(tx), let s = String(data: json, encoding: .utf8) {
        run("insert into _outbox (id, record) values (?, ?)", bind: [tx.id, s])
      }
    }
    exec("commit")
  }

  public func outboxRemove(_ id: String) async { run("delete from _outbox where id = ?", bind: [id]) }

  public func outboxAll() async -> [TxRecord] {
    var records: [TxRecord] = []
    query("select record from _outbox order by seq") { stmt in
      if let s = self.text(stmt, 0), let d = s.data(using: .utf8), let r = try? self.decoder.decode(TxRecord.self, from: d) { records.append(r) }
    }
    return records
  }

  public func wipe() async {
    exec("begin")
    for model in models() { exec("delete from \(quote(model))") }
    exec("delete from _meta")
    exec("commit")
  }
}

/// The tests' in-memory database.
public actor MemoryLocalDB: LocalDB {
  private var tables: [String: [String: Row]] = [:]
  private var meta = Meta()
  private var outbox: [TxRecord] = []
  private var hash = ""
  private var opened = false
  public init() {}

  public func open(workspace: String, schemaHash: String) async -> OpenResult {
    let existing = opened && hash == schemaHash
    hash = schemaHash
    opened = true
    if existing { return .existing }
    tables = [:]; meta = Meta(); outbox = []
    return .fresh
  }
  public func load(_ model: String) async -> [Row] { Array((tables[model] ?? [:]).values) }
  public func write(_ actions: [SyncAction]) async {
    for a in actions {
      if let d = a.data { tables[a.model, default: [:]][a.modelId] = d } else { tables[a.model]?.removeValue(forKey: a.modelId) }
    }
  }
  public func metaGet() async -> Meta { meta }
  public func metaSet(_ m: Meta) async { meta = m }
  public func outboxPut(_ txs: [TxRecord]) async { outbox += txs }
  public func outboxRemove(_ id: String) async { outbox.removeAll { $0.id == id } }
  public func outboxAll() async -> [TxRecord] { outbox }
  public func wipe() async { tables = [:]; meta = Meta() }
}
