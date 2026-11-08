// swift-tools-version: 6.0
import PackageDescription

// Arc's native client: `Sync` is the sync engine of docs/sync-engine-v1-spec.md in Swift, class for class with
// packages/sync (registry, pool, transaction queue, sync client, local database, transport); `Glass` is the app,
// Mail's three columns on a pane of frosted glass. `swift run Glass` from this folder opens it against the local API.
let package = Package(
  name: "Glass",
  platforms: [.macOS(.v15)],
  targets: [
    .target(name: "Sync", path: "Sources/Sync"),
    .executableTarget(
      name: "Glass",
      dependencies: ["Sync"],
      path: "Sources/Glass",
      swiftSettings: [.unsafeFlags(["-parse-as-library"])]
    ),
    .testTarget(name: "SyncTests", dependencies: ["Sync"], path: "Tests/SyncTests"),
  ]
)
