// swift-tools-version: 6.0
//
// MLR Assistant — Apple Foundation Models inference service.
//
// Runs on the Mac mini (the only place Apple's models run). Exposes a tiny HTTP
// endpoint the app's generateAssistantAnswer() seam calls. See README.md for
// requirements (macOS 27 + Apple Intelligence + Xcode 27) and the launchd setup.

import PackageDescription

let package = Package(
    name: "fm-service",
    platforms: [
        // macOS 27: the Private Cloud Compute model + the LanguageModelSession
        // model-selection / ContextOptions APIs this service uses are 27.0+.
        // (The on-device-only path alone would build on macOS 26.)
        .macOS("27.0"),
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
