import Foundation
import Observation

/// What a model needs from the store it lives in (packages/sync/src/model.ts `Core`).
@MainActor
public protocol Core: AnyObject {
  var pool: ObjectPool { get }
  func materialize(_ model: String, _ row: Row) -> Model
  func enqueue(_ kind: TxKind, _ model: Model, changes: Row?, original: Row?) -> Transaction
}

/// A row in memory. Its values live in `data`, which the engine reads at once; `version` is the one observable, bumped
/// on every write, so a SwiftUI view that read any field re-renders when the row changes (the per-field grain of the
/// TS signals, coarsened to the row: fine for an app this size).
@MainActor
@Observable
public class Model: Identifiable {
  @ObservationIgnored public var meta: ModelMeta { fatalError("subclass") }
  @ObservationIgnored public var data: Row = [:]
  @ObservationIgnored public weak var store: (any Core)?
  /// Unsaved edits: each edited field's value before its first edit.
  @ObservationIgnored public var original: Row = [:]
  @ObservationIgnored public var persisted = false
  /// Changes whenever a field does; reading it in a view subscribes the view.
  public private(set) var version = 0

  public required init() {}

  public nonisolated var id: String { MainActor.assumeIsolated { data.id } }
  public var createdAt: Date { data["createdAt"]?.date ?? .distantPast }
  public var updatedAt: Date { data["updatedAt"]?.date ?? .distantPast }
  public var archivedAt: Date? { data["archivedAt"]?.date }
  public var isPersisted: Bool { persisted }
  public var changedFields: [String] { Array(original.keys) }

  // Reading and writing fields, with the local-edit bookkeeping the TS decorators do.
  public func get(_ field: String) -> JSON {
    _ = version
    return data[field] ?? .null
  }

  public func set(_ field: String, _ value: JSON) {
    let before = data[field] ?? .null
    if before == value { return }
    if original[field] == nil { original[field] = before }
    else if original[field] == value { original.removeValue(forKey: field) }
    write(field, value)
  }

  /// The one way a stored field changes, for local edits and server data alike.
  public func write(_ field: String, _ value: JSON) {
    let before = data[field] ?? .null
    if before == value { return }
    data[field] = value
    version += 1
    // Indexed fields move the model between the pool's lists; a reference is indexed by its id field.
    if let f = meta.fields.values.first(where: { ($0.foreignKey ?? "") == field && $0.indexed }) ?? meta.fields[field], f.indexed {
      store?.pool.move(self, field, before, value)
    }
  }

  @discardableResult
  public func save() -> Transaction {
    let was = original
    if was.isEmpty { return Transaction.settled() }
    original = [:]
    var changes: Row = [:]
    for field in was.keys { changes[field] = data[field] ?? .null }
    return store!.enqueue(.update, self, changes: changes, original: was)
  }

  @discardableResult
  public func archive() -> Transaction { setArchived(.archive, .date(Date())) }
  @discardableResult
  public func unarchive() -> Transaction { setArchived(.unarchive, .null) }

  private func setArchived(_ kind: TxKind, _ at: JSON) -> Transaction {
    let was: Row = ["archivedAt": data["archivedAt"] ?? .null]
    write("archivedAt", at)
    return store!.enqueue(kind, self, changes: ["archivedAt": at], original: was)
  }

  @discardableResult
  public func delete() -> Transaction {
    store!.pool.remove(id)
    return store!.enqueue(.delete, self, changes: nil, original: data)
  }

  public func discardChanges() {
    for (field, value) in original { write(field, value) }
    original = [:]
  }

  // Typed accessors the product models use.
  public func string(_ f: String) -> String { get(f).string ?? "" }
  public func optionalString(_ f: String) -> String? { get(f).string }
  public func strings(_ f: String) -> [String] { get(f).strings }
  public func date(_ f: String) -> Date? { get(f).date }
  public func bool(_ f: String) -> Bool { get(f).bool ?? false }
  public func number(_ f: String) -> Double { get(f).number ?? 0 }

  /// The model a reference field points at, if it's loaded.
  public func ref<T: Model>(_ key: String, as type: T.Type) -> T? {
    guard let id = get(key).string else { return nil }
    return store?.pool.get(id) as? T
  }

  /// The models of `type` whose `key` is this one's id (a OneToMany), unarchived.
  public func children<T: Model>(_ type: T.Type, key: String) -> [T] {
    (store?.pool.byIndex(type.init().meta.name, key, .string(id)) ?? []).compactMap { $0 as? T }.filter { $0.archivedAt == nil }
  }
}

extension Array where Element: Model {
  /// Sorted by a date field, as `Collection.sorted("createdAt")`.
  @MainActor
  public func sorted(byDate field: String, descending: Bool = false) -> [Element] {
    sorted { a, b in
      let x = a.data[field]?.number ?? 0
      let y = b.data[field]?.number ?? 0
      return descending ? x > y : x < y
    }
  }
}
