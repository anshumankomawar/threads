// swift-tools-version: 6.0
import PackageDescription

// A try of a look, not a product: a borderless dark window of frosted glass over the desktop, with a fine dot grid
// etched across it and a few quiet controls floating on it. `swift run` from this folder opens it.
let package = Package(
  name: "Glass",
  platforms: [.macOS(.v15)],
  targets: [
    .executableTarget(
      name: "Glass",
      path: "Sources",
      swiftSettings: [.unsafeFlags(["-parse-as-library"])]
    )
  ]
)
