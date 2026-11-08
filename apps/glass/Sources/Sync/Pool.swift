import Foundation
import Observation

/// Every model in memory, by id, by model name (`all`) and by indexed field value (`byIndex`). Each list is its own
/// observable, so a change to one notifies only the views that read it (packages/sync/src/pool.ts).
@MainActor
public final class ObjectPool {
  @Observable
  final class Bucket {
    @ObservationIgnored var models: [String: Model] = [:]
    private(set) var version = 0
    func changed() { version += 1 }
  }

  private var models: [String: Model] = [:]
  private var buckets: [String: Bucket] = [:]
  /// Per id, so a read of a model that isn't here yet updates when it arrives.
  private var ids: [String: Bucket] = [:]

  public init() {}

  private func idSlot(_ id: String) -> Bucket {
    if let b = ids[id] { return b }
    let b = Bucket()
    ids[id] = b
    return b
  }

  private func bucket(_ model: String, _ field: String? = nil, _ value: JSON? = nil) -> Bucket {
    let key = "\(model)\u{1}\(field ?? "")\u{1}\(value.map { String(describing: $0) } ?? "")"
    if let b = buckets[key] { return b }
    let b = Bucket()
    buckets[key] = b
    return b
  }

  private func lists(_ model: Model) -> [Bucket] {
    let meta = model.meta
    // A reference is indexed by its id field (`userId`), which is what the row stores; a property by its own name.
    return [bucket(meta.name)] + meta.fields.filter { $0.value.indexed }.map { entry in
      let key = entry.value.foreignKey ?? entry.key
      return bucket(meta.name, key, model.data[key] ?? .null)
    }
  }

  public func get(_ id: String) -> Model? {
    _ = idSlot(id).version
    return models[id]
  }

  public func allIds() -> [String] { Array(models.keys) }

  public func put(_ model: Model) {
    models[model.id] = model
    idSlot(model.id).changed()
    for b in lists(model) {
      b.models[model.id] = model
      b.changed()
    }
  }

  public func remove(_ id: String) {
    guard let model = models[id] else { return }
    models.removeValue(forKey: id)
    idSlot(id).changed()
    for b in lists(model) {
      b.models.removeValue(forKey: id)
      b.changed()
    }
  }

  /// An indexed field changed: the model moves between buckets.
  public func move(_ model: Model, _ field: String, _ before: JSON, _ after: JSON) {
    guard models[model.id] === model else { return }
    let from = bucket(model.meta.name, field, before)
    let to = bucket(model.meta.name, field, after)
    from.models.removeValue(forKey: model.id)
    to.models[model.id] = model
    from.changed()
    to.changed()
  }

  public func byIndex(_ model: String, _ field: String, _ value: JSON) -> [Model] { read(bucket(model, field, value)) }
  public func all(_ model: String) -> [Model] { read(bucket(model)) }

  private func read(_ b: Bucket) -> [Model] {
    _ = b.version
    return Array(b.models.values)
  }
}
