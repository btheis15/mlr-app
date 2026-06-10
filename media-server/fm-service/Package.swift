// swift-tools-version: 6.0
//
// MLR Assistant — Apple Foundation Models inference service (SCAFFOLD).
//
// Runs on the Mac mini (the only place Apple's on-device model runs). Exposes a
// tiny HTTP endpoint the app's generateAssistantAnswer() seam calls in Phase 2.
// See README.md for requirements (macOS 26 + Apple Intelligence + Xcode 26) and
// the launchd setup. This is a starting point, not a hardened service.

import PackageDescription

let package = Package(
    name: "fm-service",
    platforms: [
        // FoundationModels requires macOS 26 (Tahoe) or later.
        .macOS("26.0"),
    ],
    dependencies: [
        // Vapor is just the HTTP layer; the inference uses Apple's first-party
        // FoundationModels framework (no package dependency — it's in the SDK).
        .package(url: "https://github.com/vapor/vapor.git", from: "4.92.0"),
    ],
    targets: [
        .executableTarget(
            name: "fm-service",
            dependencies: [
                .product(name: "Vapor", package: "vapor"),
            ]
        ),
    ]
)
