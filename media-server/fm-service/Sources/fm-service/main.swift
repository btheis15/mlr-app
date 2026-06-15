// MLR Assistant — Apple Foundation Models inference service.
//
// Contract (matches lib/assistant/generate.ts):
//   POST /assistant         { system, question, context } -> 200 { answer, model }   (blocking)
//   POST /assistant/stream  { system, question, context } -> 200 text/event-stream
//                             data: {"delta":"..."}  (repeated) then  event: done {"model":"…"}
//   503 { error: "model_unavailable" } when no model is ready.
//   401 when FM_SHARED_SECRET is set and the X-FM-Token header doesn't match.
//
// The app's server already did auth + intent + retrieval; this service ONLY turns
// the supplied system prompt + context into a short answer with an Apple
// Foundation Model. It never reaches into the database and never sees a chat.
// Bind to localhost and reach it over the private tunnel/loopback. See README.md.
//
// macOS/iOS 27 model story — two models, both first-party:
//   • PrivateCloudComputeLanguageModel (NEW in 27): a much more capable model run
//     in Apple's Private Cloud Compute (privacy-preserving — requests aren't
//     retained server-side), with a far larger context window than on-device.
//     Preferred WHEN USABLE — but its inference is entitlement-gated, so a probe
//     at startup confirms it actually works before we route to it (see below).
//   • SystemLanguageModel (on-device): the small Apple Silicon model. The default
//     when PCC isn't usable, and the automatic fallback if a PCC request fails,
//     so the assistant degrades gracefully instead of failing.
// FM_USE_PCC=0 forces on-device only (e.g. to keep every byte on the machine).

import Foundation
import Vapor
import FoundationModels

struct AskRequest: Content {
    let system: String
    let question: String
    let context: String
}

struct AskResponse: Content {
    let answer: String
    // Which model produced the answer ("private-cloud-compute" | "on-device").
    // Purely informational — the app reads only `answer`.
    let model: String
}

let app = try await Application.make(.detect())
app.http.server.configuration.hostname = Environment.get("FM_HOST") ?? "127.0.0.1"
app.http.server.configuration.port = Int(Environment.get("FM_PORT") ?? "8788") ?? 8788

// Shared-secret gate. When FM_SHARED_SECRET is set, every request must carry a
// matching `X-FM-Token` header — this is what makes it safe to reach the service
// over a public tunnel: only the app's server (which holds the secret) can call
// it. Unset → open (loopback / local dev).
let requiredSecret = Environment.get("FM_SHARED_SECRET").flatMap { $0.isEmpty ? nil : $0 }

// MARK: - Model selection

// Prefer Private Cloud Compute unless explicitly disabled.
let preferPCC = !["0", "false", "no", "off"].contains((Environment.get("FM_USE_PCC") ?? "1").lowercased())

// Output ceilings. The on-device model is tiny and prefill-bound, so keep it
// tight (1–3 sentences). PCC is far more capable, so give it a roomier — still
// concise — budget. Both are env-overridable.
let onDeviceMaxTokens = Int(Environment.get("FM_MAX_TOKENS") ?? "256") ?? 256
let pccMaxTokens = Int(Environment.get("FM_PCC_MAX_TOKENS") ?? "700") ?? 700

// Reasoning effort for the PCC model. These are short, grounded lookups, so
// `light` keeps latency (and reasoning-token spend) low; bump to moderate/deep
// only if answers need more synthesis.
let pccReasoning: ContextOptions.ReasoningLevel = {
    switch (Environment.get("FM_PCC_REASONING") ?? "light").lowercased() {
    case "moderate": return .moderate
    case "deep": return .deep
    default: return .light
    }
}()

// Single long-lived handles. Cheap to hold.
let pccModel = PrivateCloudComputeLanguageModel()
let onDeviceModel = SystemLanguageModel.default

enum ActiveModel {
    case privateCloud
    case onDevice

    var label: String {
        switch self {
        case .privateCloud: return "private-cloud-compute"
        case .onDevice: return "on-device"
        }
    }
}

// Whether PCC actually WORKS — decided ONCE at startup. Availability != usability:
// PCC inference is entitlement-gated, so an unsigned/ad-hoc build sees
// `availability == .available` yet every generation fails fast with
// `ModelManagerError 1046`. We confirm with a real (tiny) generation and only
// prefer PCC if it succeeds; otherwise we stay fully on-device — no per-request
// PCC attempts, no log spam. This re-runs every process start, so code-signing
// the binary with the Foundation Models entitlement (+ restart) flips PCC on
// automatically with no config change. `FM_USE_PCC=0` forces on-device and skips
// the probe.
func probePCCUsable() async -> Bool {
    guard preferPCC else { return false }
    guard case .available = pccModel.availability, !pccModel.quotaUsage.isLimitReached else {
        app.logger.notice("Private Cloud Compute unavailable; using on-device.")
        return false
    }
    do {
        let probe = LanguageModelSession(model: pccModel, instructions: "Reply with the single word: ok")
        _ = try await probe.respond(to: "Say ok.", options: GenerationOptions(samplingMode: .greedy, maximumResponseTokens: 8))
        return true
    } catch {
        app.logger.notice("Private Cloud Compute not usable yet — staying on-device. Most likely a signing/entitlement gate (ModelManagerError 1046); see README. Detail: \(String(reflecting: error))")
        return false
    }
}
let pccUsable = await probePCCUsable()
app.logger.notice("MLR Assistant generation model: \(pccUsable ? "Private Cloud Compute (with on-device fallback)" : "on-device")")

// The models to try, best-first, for *this* request. PCC is gated by the startup
// probe above (so when it's not usable we never touch it here). On-device trails
// it as the fallback. PCC quota is re-checked since it can be exhausted mid-run,
// and any per-request PCC failure still falls through to on-device in the handlers.
func preferredModels() -> [ActiveModel] {
    var order: [ActiveModel] = []
    if pccUsable, !pccModel.quotaUsage.isLimitReached {
        order.append(.privateCloud)
    }
    if case .available = onDeviceModel.availability {
        order.append(.onDevice)
    }
    return order
}

// A FRESH session per request — deliberately. A single LanguageModelSession
// rejects overlapping calls with `.concurrentRequests`, so reusing one would
// serialize (and error) under load. With a session each, requests run
// concurrently: on macOS 27 the model overlaps them (measured ~3 distinct
// requests in ~1×-single wall-clock on-device; PCC, being server-side,
// parallelizes too — bounded by its quota). The keep-warm loop also uses its own
// session for the same reason.
func makeSession(_ choice: ActiveModel, instructions: String) -> LanguageModelSession {
    // Pass the concrete model type (not an existential) so there's no ambiguity.
    switch choice {
    case .privateCloud: return LanguageModelSession(model: pccModel, instructions: instructions)
    case .onDevice: return LanguageModelSession(model: onDeviceModel, instructions: instructions)
    }
}

func options(for choice: ActiveModel) -> (generation: GenerationOptions, context: ContextOptions) {
    switch choice {
    case .privateCloud:
        return (GenerationOptions(samplingMode: .greedy, maximumResponseTokens: pccMaxTokens),
                ContextOptions(reasoningLevel: pccReasoning))
    case .onDevice:
        // Greedy + tight cap: stable, slightly faster replies on the small model.
        return (GenerationOptions(samplingMode: .greedy, maximumResponseTokens: onDeviceMaxTokens),
                ContextOptions())
    }
}

// MARK: - Helpers

func checkSecret(_ req: Request) throws {
    guard let requiredSecret else { return }
    guard req.headers.first(name: "X-FM-Token") == requiredSecret else {
        throw Abort(.unauthorized, reason: "unauthorized")
    }
}

func buildPrompt(_ body: AskRequest) -> String {
    """
    Context records (answer only from these):
    \(body.context)

    Question: \(body.question)
    """
}

func sseField(_ dict: [String: String]) -> String {
    // JSON-encode the payload so any newlines in the text become \n and can't
    // break SSE line framing.
    if let data = try? JSONEncoder().encode(dict), let s = String(data: data, encoding: .utf8) {
        return s
    }
    return "{}"
}

// MARK: - Endpoints

// Blocking endpoint — the fallback the app degrades to if streaming fails. Tries
// PCC first, then on-device; a model failure (e.g. a PCC network blip) silently
// falls through to the next candidate rather than erroring the call.
app.post("assistant") { req async throws -> AskResponse in
    try checkSecret(req)
    let body = try req.content.decode(AskRequest.self)
    let candidates = preferredModels()
    guard !candidates.isEmpty else { throw Abort(.serviceUnavailable, reason: "model_unavailable") }

    let prompt = buildPrompt(body)
    var lastError: Error?
    for choice in candidates {
        do {
            let opts = options(for: choice)
            let session = makeSession(choice, instructions: body.system)
            let result = try await session.respond(to: prompt, options: opts.generation, contextOptions: opts.context)
            req.logger.info("assistant answered via \(choice.label)")
            return AskResponse(answer: result.content, model: choice.label)
        } catch {
            lastError = error
            req.logger.warning("assistant \(choice.label) failed: \(String(reflecting: error))")
        }
    }
    req.logger.error("assistant: all models failed: \(String(reflecting: lastError))")
    throw Abort(.serviceUnavailable, reason: "generation_failed")
}

// Streaming endpoint (Server-Sent Events). Emits the newly-generated text as
// `data: {"delta":"..."}` events (the model yields cumulative snapshots; we send
// only the delta), then a final `event: done` carrying the model that answered.
// If the primary model fails BEFORE any text is sent, we transparently restart on
// the next candidate; once bytes have gone out we can't cleanly switch, so a late
// failure ends with `event: error`.
app.post("assistant", "stream") { req async throws -> Response in
    try checkSecret(req)
    let body = try req.content.decode(AskRequest.self)
    let candidates = preferredModels()
    guard !candidates.isEmpty else { throw Abort(.serviceUnavailable, reason: "model_unavailable") }

    let res = Response(status: .ok)
    res.headers.replaceOrAdd(name: .contentType, value: "text/event-stream")
    res.headers.replaceOrAdd(name: .cacheControl, value: "no-cache")
    res.headers.replaceOrAdd(name: .connection, value: "keep-alive")

    let prompt = buildPrompt(body)
    let instructions = body.system
    let logger = req.logger
    res.body = .init(managedAsyncStream: { writer in
        // Managed stream: do NOT call .end/.error — returning/throwing ends it.
        var sentAny = false
        for choice in candidates {
            do {
                let opts = options(for: choice)
                let session = makeSession(choice, instructions: instructions)
                let stream = session.streamResponse(to: prompt, options: opts.generation, contextOptions: opts.context)
                var last = ""
                for try await snapshot in stream {
                    let full = snapshot.content
                    guard full.count > last.count else { continue }
                    let delta = String(full.dropFirst(last.count))
                    last = full
                    sentAny = true
                    try await writer.write(.buffer(ByteBuffer(string: "data: \(sseField(["delta": delta]))\n\n")))
                }
                try await writer.write(.buffer(ByteBuffer(string: "event: done\ndata: \(sseField(["model": choice.label]))\n\n")))
                logger.info("assistant streamed via \(choice.label)")
                return
            } catch {
                logger.warning("assistant stream \(choice.label) failed: \(String(reflecting: error))")
                if sentAny { break } // already streaming — fall through to the error event
            }
        }
        try await writer.write(.buffer(ByteBuffer(string: "event: error\ndata: \(sseField(["error": "generation_failed"]))\n\n")))
    })
    return res
}

// MARK: - Warmup

// Warm the on-device model (our fallback) so the first fallback isn't a cold load.
let warmup = LanguageModelSession(model: onDeviceModel, instructions: "Reply with the single word: ok")
warmup.prewarm()

// Keep the on-device model + its content-safety (SensitiveContentAnalysis) assets
// resident. A long-idle process otherwise loses access to those assets and then
// fails EVERY on-device request with a FoundationModels GenerationError →
// ModelManagerError 1013 until it's restarted (observed after ~15 min idle; a
// fresh process always works). A small periodic generation keeps the pipeline
// warm. PCC has no such idle-eviction problem and every call spends quota, so we
// deliberately do NOT poll it here. Best-effort: errors are swallowed so a
// transient blip never crashes the service.
Task {
    while true {
        try? await Task.sleep(for: .seconds(120))
        guard case .available = onDeviceModel.availability else { continue }
        let warm = LanguageModelSession(model: onDeviceModel, instructions: "Reply with the single word: ok")
        _ = try? await warm.respond(to: "Say ok.")
    }
}

try await app.execute()
