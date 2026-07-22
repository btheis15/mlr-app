// swift-tools-version: 6.0
//
// MLR embed-service — on-device text embeddings for semantic search.
//
// Runs on the Mac mini. Turns text into 512-d vectors with Apple's
// NaturalLanguage framework (NLContextualEmbedding) — fully on-device, private,
// no network, no quota. DELIBERATELY does NOT import FoundationModels: it is
// isolated from the assistant/`fm-service` so the (currently SIGTRAP-prone on
// this beta) generation path can't take semantic search down with it. See
// README.md for the launchd setup + how media-server calls it.

import PackageDescription

let package = Package(
    name: "embed-service",
    platforms: [
        // NLContextualEmbedding + enumerateTokenVectors(in:using:) are macOS 14+.
        .macOS(.v14),
    ],
    dependencies: [
        // Vapor is only the HTTP layer; embeddings are Apple's first-party
        // NaturalLanguage framework (in the SDK, no package dependency).
        .package(url: "https://github.com/vapor/vapor.git", from: "4.92.0"),
    ],
    targets: [
        .executableTarget(
            name: "embed-service",
            dependencies: [
                .product(name: "Vapor", package: "vapor"),
            ],
            // Language mode 5: this is a tiny single-file loopback service that
            // deliberately shares one serialized model handle across requests;
            // Swift 6 strict-concurrency adds no safety here, only annotation churn.
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
