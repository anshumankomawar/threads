import Foundation

/// Every model's metadata and how to make one, shared in spirit with the server, which validates mutations and builds
/// tables from the same shape (packages/sync/src/registry.ts).
@MainActor
public final class ModelRegistry {
  private var models: [String: (meta: ModelMeta, make: () -> Model)] = [:]
  private var order: [String] = []

  public init() {}

  public func register(_ meta: ModelMeta, make: @escaping () -> Model) {
    if models[meta.name] == nil { order.append(meta.name) }
    models[meta.name] = (meta, make)
  }

  public func meta(_ name: String) -> ModelMeta { models[name]!.meta }
  public func make(_ name: String) -> Model { models[name]!.make() }
  public func all() -> [ModelMeta] { order.map { models[$0]!.meta } }

  /// Changes => the local data is wiped and bootstrapped again. The server's hash is what counts (BootstrapEnd); this
  /// one only has to differ when the Swift models change, so a stale cache from an older build starts over.
  public var schemaHash: String {
    var hash: UInt32 = 0x811c9dc5
    for meta in all().sorted(by: { $0.name < $1.name }) {
      for char in meta.name.utf8 { hash = (hash ^ UInt32(char)) &* 0x01000193 }
      for key in meta.fields.keys.sorted() {
        let f = meta.fields[key]!
        let shape = "\(key):\(f.kind):\(f.target ?? ""):\(f.foreignKey ?? ""):\(f.indexed):\(f.nullable):\(f.enum ?? []):\(f.isDate)"
        for char in shape.utf8 { hash = (hash ^ UInt32(char)) &* 0x01000193 }
      }
    }
    return String(hash, radix: 16)
  }
}

@MainActor public let registry = ModelRegistry()

/// The admin's only group: it sees everything.
public let ALL = "*"

/// Whether holding `mine` you see a row in `theirs`.
public func sees(_ mine: [String], _ theirs: [String]) -> Bool {
  mine.contains(ALL) || theirs.contains(where: mine.contains)
}

/// A field declaration, for `ModelMeta` built by hand in Models.swift.
public enum Field {
  public static func property(indexed: Bool = false, nullable: Bool = false, enum values: [String]? = nil, date: Bool = false) -> FieldMeta {
    FieldMeta(kind: .property, indexed: indexed, nullable: nullable, enum: values, isDate: date)
  }
  public static func reference(_ target: String, key: String, nullable: Bool = false, indexed: Bool = false) -> FieldMeta {
    FieldMeta(kind: .reference, target: target, foreignKey: key, indexed: indexed, nullable: nullable)
  }
  public static func oneToMany(_ target: String, key: String) -> FieldMeta {
    FieldMeta(kind: .oneToMany, target: target, foreignKey: key)
  }
}
