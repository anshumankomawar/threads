import Foundation

// The spec's wire types (packages/protocol), exactly: what goes over HTTP and the socket.

/// A JSON value, as rows and changes carry them. Dates are milliseconds, as the server stores them.
public enum JSON: Hashable, Sendable, Codable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSON])
  case object([String: JSON])

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let a = try? c.decode([JSON].self) { self = .array(a) }
    else { self = .object(try c.decode([String: JSON].self)) }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n): try c.encode(n)
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }

  public var string: String? { if case .string(let s) = self { return s } else { return nil } }
  public var number: Double? { if case .number(let n) = self { return n } else { return nil } }
  public var bool: Bool? { if case .bool(let b) = self { return b } else { return nil } }
  public var array: [JSON]? { if case .array(let a) = self { return a } else { return nil } }
  public var object: [String: JSON]? { if case .object(let o) = self { return o } else { return nil } }
  public var isNull: Bool { if case .null = self { return true } else { return false } }
  public var strings: [String] { array?.compactMap(\.string) ?? [] }
  /// Milliseconds since 1970, as a date.
  public var date: Date? { number.map { Date(timeIntervalSince1970: $0 / 1000) } }

  public static func date(_ d: Date) -> JSON { .number((d.timeIntervalSince1970 * 1000).rounded()) }
  public static func strings(_ s: [String]) -> JSON { .array(s.map { .string($0) }) }
}

public typealias Row = [String: JSON]

extension Row {
  public var id: String { self["id"]?.string ?? "" }
}

public enum TxKind: String, Codable, Sendable { case create, update, archive, unarchive, delete }

public struct TxRecord: Codable, Sendable, Equatable {
  public var id: String  // idempotency key
  public var kind: TxKind
  public var model: String
  public var modelId: String
  public var changes: Row?  // create/update: new values
  public var original: Row?  // for rollback and rebase
  public var batch: Int  // same tick = same batch

  public init(id: String, kind: TxKind, model: String, modelId: String, changes: Row?, original: Row?, batch: Int) {
    self.id = id
    self.kind = kind
    self.model = model
    self.modelId = modelId
    self.changes = changes
    self.original = original
    self.batch = batch
  }
}

public struct SyncAction: Codable, Sendable, Equatable {
  public var id: Int
  public var txId: String
  public var model: String
  public var modelId: String
  public var action: String  // I U A R D
  public var data: Row?

  public init(id: Int, txId: String, model: String, modelId: String, action: String, data: Row?) {
    self.id = id
    self.txId = txId
    self.model = model
    self.modelId = modelId
    self.action = action
    self.data = data
  }

  /// A row as a bootstrap or local load hands it over.
  public static func insert(_ model: String, _ row: Row) -> SyncAction {
    SyncAction(id: 0, txId: "", model: model, modelId: row.id, action: "I", data: row)
  }
}

public struct MutateRequest: Codable, Sendable { public var transactions: [TxRecord] }

public struct MutateResult: Codable, Sendable {
  public var txId: String
  public var ok: Bool
  public var syncId: Int?
  public var code: String?
  public var message: String?
}

public struct MutateResponse: Codable, Sendable { public var results: [MutateResult] }

public struct DeltasResponse: Codable, Sendable {
  public var actions: [SyncAction]
  public var lastSyncId: Int
  public var groups: [String]
}

public struct Hello: Codable, Sendable {
  public var type = "hello"
  public var lastSyncId: Int
  public var token: String
  public var subscribed: [String]
}

public struct BootstrapLine: Codable, Sendable {
  public var model: String
  public var row: Row
}

public struct BootstrapEnd: Codable, Sendable {
  public var lastSyncId: Int
  public var schemaHash: String
  public var groups: [String]
  public var actions: [SyncAction]
}

public struct ActionResponse: Codable, Sendable { public var lastSyncId: Int }

public enum FieldKind: Sendable { case property, ephemeral, reference, oneToMany }

/// A field's metadata, as the server validates it. `target` names a reference's model; `foreignKey` its id field.
public struct FieldMeta: Sendable {
  public var kind: FieldKind
  public var target: String?
  public var foreignKey: String?
  public var indexed = false
  public var nullable = false
  public var `enum`: [String]?
  public var isDate = false

  public init(kind: FieldKind, target: String? = nil, foreignKey: String? = nil, indexed: Bool = false, nullable: Bool = false, enum values: [String]? = nil, isDate: Bool = false) {
    self.kind = kind
    self.target = target
    self.foreignKey = foreignKey
    self.indexed = indexed
    self.nullable = nullable
    self.enum = values
    self.isDate = isDate
  }
}

public struct ModelMeta: Sendable {
  public var name: String
  public var fields: [String: FieldMeta]
  public var syncGroup: (@Sendable (Row) -> [String])?
}
