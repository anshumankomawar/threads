import Foundation

/// Links in a message's text (packages/models/src/text.ts): `[[thread:<id>]]` links a thread, `[[person:<id>]]`
/// mentions someone, `[[subspace:<id>]]` everyone in a subspace, `[[date:<ms>]]` a date.
public enum TextPart: Equatable, Sendable {
  case text(String)
  case thread(String)
  case person(String)
  case subspace(String)
  case date(Date)
}

private let token = try! NSRegularExpression(pattern: #"\[\[(thread|person|subspace|date):([^\]\s]+)\]\]"#)

public func splitText(_ text: String) -> [TextPart] {
  var parts: [TextPart] = []
  let ns = text as NSString
  var at = 0
  for m in token.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
    if m.range.location > at { parts.append(.text(ns.substring(with: NSRange(location: at, length: m.range.location - at)))) }
    let kind = ns.substring(with: m.range(at: 1))
    let id = ns.substring(with: m.range(at: 2))
    switch kind {
    case "thread": parts.append(.thread(id))
    case "person": parts.append(.person(id))
    case "subspace": parts.append(.subspace(id))
    default: parts.append(.date(Date(timeIntervalSince1970: (Double(id) ?? 0) / 1000)))
    }
    at = m.range.location + m.range.length
  }
  if at < ns.length { parts.append(.text(ns.substring(from: at))) }
  return parts
}

public func mention(_ id: String) -> String { "[[person:\(id)]]" }
public func subspaceMention(_ id: String) -> String { "[[subspace:\(id)]]" }
public func threadLink(_ id: String) -> String { "[[thread:\(id)]]" }

public func mentionsIn(_ text: String) -> [String] {
  splitText(text).compactMap { if case .person(let id) = $0 { id } else { nil } }
}

/// The text with links as `#title` and mentions as `@name`.
public func plainText(_ text: String, titleOf: (String) -> String?, nameOf: (String) -> String?, subspaceOf: (String) -> String? = { _ in nil }) -> String {
  splitText(text).map { part -> String in
    switch part {
    case .text(let s): s
    case .thread(let id): "#\(titleOf(id) ?? "thread")"
    case .person(let id): "@\(nameOf(id) ?? "someone")"
    case .subspace(let id): "@\(subspaceOf(id) ?? "subspace")"
    case .date(let d): d.formatted(.dateTime.month(.abbreviated).day())
    }
  }.joined()
}
