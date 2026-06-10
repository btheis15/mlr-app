// MLR Assistant — Apple Foundation Models inference service.
//
// Contract (matches lib/assistant/generate.ts):
//   POST /assistant         { system, question, context } -> 200 { answer }   (blocking)
//   POST /assistant/stream  { system, question, context } -> 200 text/event-stream
//                             data: {"delta":"..."}  (repeated) then  event: done
//   503 { error: "model_unavailable" } when Apple Intelligence is off / not ready.
//   401 when FM_SHARED_SECRET is set and the X-FM-Token header doesn't match.
//
// The app's server already did auth + intent + retrieval; this service ONLY turns
// the supplied system prompt + context into a short answer with the on-device
// model. It never reaches into the database and never sees a chat. Bind to
// localhost and reach it over the private tunnel/loopback. See README.md.

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
}

let app = try await Application.make(.detect())
app.http.server.configuration.hostname = Environment.get("FM_HOST") ?? "127.0.0.1"
app.http.server.configuration.port = Int(Environment.get("FM_PORT") ?? "8788") ?? 8788

// Shared-secret gate. When FM_SHARED_SECRET is set, every request must carry a
// matching `X-FM-Token` header — this is what makes it safe to reach the service
// over a public tunnel: only the app's server (which holds the secret) can call
// it. Unset → open (loopback / local dev).
let requiredSecret = Environment.get("FM_SHARED_SECRET").flatMap { $0.isEmpty ? nil : $0 }

// Bound the output: answers are meant to be 1–3 sentences, so cap tokens (keeps
// the long tail in check) and use greedy sampling for stable, slightly faster
// replies. The M1's per-request latency is dominated by prefill, not output, so
// this mostly trims the worst case.
let genOptions = GenerationOptions(sampling: .greedy, maximumResponseTokens: 256)

func checkSecret(_ req: Request) throws {
    guard let requiredSecret else { return }
    guard req.headers.first(name: "X-FM-Token") == requiredSecret else {
        throw Abort(.unauthorized, reason: "unauthorized")
    }
}

func requireAvailable() throws {
    guard case .available = SystemLanguageModel.default.availability else {
        throw Abort(.serviceUnavailable, reason: "model_unavailable")
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

// Blocking endpoint — kept as the fallback the app degrades to if streaming fails.
app.post("assistant") { req async throws -> AskResponse in
    try checkSecret(req)
    let body = try req.content.decode(AskRequest.self)
    try requireAvailable()
    let session = LanguageModelSession(instructions: body.system)
    let result = try await session.respond(to: buildPrompt(body), options: genOptions)
    return AskResponse(answer: result.content)
}

// Streaming endpoint (Server-Sent Events). Emits the newly-generated text as
// `data: {"delta":"..."}` events (the model yields cumulative snapshots; we send
// only the delta), then a final `event: done`. On failure, `event: error`.
app.post("assistant", "stream") { req async throws -> Response in
    try checkSecret(req)
    let body = try req.content.decode(AskRequest.self)
    try requireAvailable()

    let res = Response(status: .ok)
    res.headers.replaceOrAdd(name: .contentType, value: "text/event-stream")
    res.headers.replaceOrAdd(name: .cacheControl, value: "no-cache")
    res.headers.replaceOrAdd(name: .connection, value: "keep-alive")
    res.body = .init(managedAsyncStream: { writer in
        // Managed stream: do NOT call .end/.error — returning/throwing ends it.
        let session = LanguageModelSession(instructions: body.system)
        let stream = session.streamResponse(to: buildPrompt(body), options: genOptions)
        do {
            var last = ""
            for try await snapshot in stream {
                let full = snapshot.content
                guard full.count > last.count else { continue }
                let delta = String(full.dropFirst(last.count))
                last = full
                try await writer.write(.buffer(ByteBuffer(string: "data: \(sseField(["delta": delta]))\n\n")))
            }
            try await writer.write(.buffer(ByteBuffer(string: "event: done\ndata: {}\n\n")))
        } catch {
            try await writer.write(.buffer(ByteBuffer(string: "event: error\ndata: \(sseField(["error": "generation_failed"]))\n\n")))
        }
    })
    return res
}

// Warm the model at process start so the first real request isn't a cold load.
let warmup = LanguageModelSession(instructions: "Reply with the single word: ok")
warmup.prewarm()

// Keep the model + its content-safety (SensitiveContentAnalysis) assets resident.
// A long-idle process otherwise loses access to those assets and then fails EVERY
// request with a FoundationModels GenerationError → ModelManagerError 1013 until
// it's restarted (observed after ~15 min idle; a fresh process always works). A
// small periodic generation keeps the whole pipeline warm. Best-effort: every
// error here is swallowed so a transient blip never crashes the service.
Task {
    while true {
        try? await Task.sleep(for: .seconds(120))
        guard case .available = SystemLanguageModel.default.availability else { continue }
        let warm = LanguageModelSession(instructions: "Reply with the single word: ok")
        _ = try? await warm.respond(to: "Say ok.")
    }
}

try await app.execute()
