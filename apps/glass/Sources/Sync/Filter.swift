import Foundation

/// A saved query over one model, in Linear's shape (packages/sync/src/filter.ts): each field maps to a comparison of
/// its stored value, and `and` / `or` combine filters. A string value starting with `$` is a variable, such as `$me`.
public typealias Filter = JSON

private func empty(_ value: JSON) -> Bool {
  value.isNull || (value.array?.isEmpty ?? false)
}

private func compare(_ stored: JSON, _ comparison: [String: JSON], _ fill: (JSON) -> JSON) -> Bool {
  if let eq = comparison["eq"], stored != fill(eq) { return false }
  if let neq = comparison["neq"], stored == fill(neq) { return false }
  if let within = comparison["in"]?.array, !within.map(fill).contains(stored) { return false }
  if let nin = comparison["nin"]?.array, nin.map(fill).contains(stored) { return false }
  if let contains = comparison["contains"], !(stored.array?.contains(fill(contains)) ?? false) { return false }
  if let none = comparison["null"]?.bool, empty(stored) != none { return false }
  return true
}

/// Whether `model` passes `filter`, reading each field so a view over it updates as they change.
@MainActor
public func matches(_ model: Model, _ filter: Filter, variables: [String: JSON] = [:]) -> Bool {
  guard let entries = filter.object else { return true }
  let fill: (JSON) -> JSON = { value in
    if let s = value.string, s.hasPrefix("$") { return variables[String(s.dropFirst())] ?? .null }
    return value
  }
  for (key, value) in entries {
    if key == "and" { if !(value.array ?? []).allSatisfy({ matches(model, $0, variables: variables) }) { return false }; continue }
    if key == "or" { if !(value.array ?? []).contains(where: { matches(model, $0, variables: variables) }) { return false }; continue }
    guard let comparison = value.object else { continue }
    if !compare(model.get(key), comparison, fill) { return false }
  }
  return true
}
