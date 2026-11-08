import Foundation

/// A live socket: `close()` ends it; `hello()` says hello again on the same connection.
@MainActor
public protocol SocketHandle: AnyObject {
  func close()
  func hello()
}

/// How a client reaches its server (packages/sync/src/http.ts): `HTTPTransport` here, a fake in the tests. Every read
/// says which groups the client follows without being in them (`subscribed`).
@MainActor
public protocol Transport: AnyObject {
  func bootstrap(subscribed: [String], partial: (holds: [String], after: Int)?) async throws -> (rows: [BootstrapLine], end: BootstrapEnd)
  func deltas(after: Int, subscribed: [String]) async throws -> DeltasResponse
  func mutate(_ request: MutateRequest) async throws -> MutateResponse
  func action(_ name: String, _ args: JSON) async throws -> ActionResponse
  /// Opens the socket and sends `hello()` once it's open, and again on `hello()`; `onClose` fires once when it ends.
  func connect(hello: @escaping () -> Hello, onMessage: @escaping (DeltasResponse) -> Void, onClose: @escaping () -> Void) -> any SocketHandle
}

/// The spec's endpoints over URLSession and one WebSocket.
@MainActor
public final class HTTPTransport: Transport {
  let url: URL
  let workspace: String
  let token: String
  private let session = URLSession(configuration: .default)
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()

  public init(url: URL, workspace: String, token: String) {
    self.url = url
    self.workspace = workspace
    self.token = token
  }

  private func request(_ path: String, body: Data? = nil) async throws -> Data {
    var req = URLRequest(url: URL(string: path, relativeTo: url)!)
    req.httpMethod = body == nil ? "GET" : "POST"
    req.setValue(workspace, forHTTPHeaderField: "X-Workspace")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = body
    let (data, response) = try await session.data(for: req)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if (200..<300).contains(status) { return data }
    let message = "\(status) \(String(data: data, encoding: .utf8) ?? "")"
    if status < 500 { throw RejectedError(message: message) }
    throw URLError(.badServerResponse, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private func json<T: Decodable>(_ path: String, body: Data? = nil) async throws -> T {
    try decoder.decode(T.self, from: try await request(path, body: body))
  }

  private func query(_ items: [String: String]) -> String {
    var c = URLComponents()
    c.queryItems = items.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return c.percentEncodedQuery ?? ""
  }

  public func bootstrap(subscribed: [String], partial: (holds: [String], after: Int)?) async throws -> (rows: [BootstrapLine], end: BootstrapEnd) {
    var q = ["subscribed": subscribed.joined(separator: ",")]
    if let partial {
      q["holds"] = partial.holds.joined(separator: ",")
      q["after"] = String(partial.after)
    }
    let data = try await request("/sync/bootstrap?\(query(q))")
    var lines = (String(data: data, encoding: .utf8) ?? "").split(separator: "\n").filter { !$0.isEmpty }
    guard let last = lines.popLast() else { throw URLError(.badServerResponse) }
    let end = try decoder.decode(BootstrapEnd.self, from: Data(last.utf8))
    let rows = try lines.map { try decoder.decode(BootstrapLine.self, from: Data($0.utf8)) }
    return (rows, end)
  }

  public func deltas(after: Int, subscribed: [String]) async throws -> DeltasResponse {
    try await json("/sync/deltas?\(query(["after": String(after), "subscribed": subscribed.joined(separator: ",")]))")
  }

  public func mutate(_ request: MutateRequest) async throws -> MutateResponse {
    try await json("/sync/mutate", body: try encoder.encode(request))
  }

  public func action(_ name: String, _ args: JSON) async throws -> ActionResponse {
    try await json("/actions/\(name)", body: try encoder.encode(args))
  }

  public func connect(hello: @escaping () -> Hello, onMessage: @escaping (DeltasResponse) -> Void, onClose: @escaping () -> Void) -> any SocketHandle {
    var c = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    c.scheme = c.scheme == "https" ? "wss" : "ws"
    c.path = "/sync/socket"
    c.queryItems = [URLQueryItem(name: "workspace", value: workspace)]
    return Socket(task: session.webSocketTask(with: c.url!), hello: hello, onMessage: onMessage, onClose: onClose, encoder: encoder, decoder: decoder)
  }
}

@MainActor
final class Socket: SocketHandle {
  private let task: URLSessionWebSocketTask
  private let greeting: () -> Hello
  private let onMessage: (DeltasResponse) -> Void
  private var onClose: (() -> Void)?
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  init(task: URLSessionWebSocketTask, hello: @escaping () -> Hello, onMessage: @escaping (DeltasResponse) -> Void, onClose: @escaping () -> Void, encoder: JSONEncoder, decoder: JSONDecoder) {
    self.task = task
    self.greeting = hello
    self.onMessage = onMessage
    self.onClose = onClose
    self.encoder = encoder
    self.decoder = decoder
    task.resume()
    sendHello()
    receive()
  }

  private func sendHello() {
    guard let data = try? encoder.encode(greeting()), let s = String(data: data, encoding: .utf8) else { return }
    task.send(.string(s)) { [weak self] error in
      if error != nil { Task { @MainActor in self?.closed() } }
    }
  }

  private func receive() {
    task.receive { [weak self] result in
      Task { @MainActor in
        guard let self else { return }
        switch result {
        case .success(let message):
          let data: Data? = switch message {
          case .string(let s): Data(s.utf8)
          case .data(let d): d
          @unknown default: nil
          }
          if let data, let packet = try? self.decoder.decode(DeltasResponse.self, from: data) { self.onMessage(packet) }
          self.receive()
        case .failure:
          self.closed()
        }
      }
    }
  }

  private func closed() {
    guard let onClose else { return }
    self.onClose = nil
    task.cancel(with: .goingAway, reason: nil)
    onClose()
  }

  func close() { closed() }
  func hello() { if task.state == .running { sendHello() } }
}
