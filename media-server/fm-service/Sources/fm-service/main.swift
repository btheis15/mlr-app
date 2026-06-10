// MLR Assistant — Apple Foundation Models inference service (SCAFFOLD).
//
// Contract (matches lib/assistant/generate.ts → callModel):
//   POST /assistant   { "system": "...", "question": "...", "context": "..." }
//   200               { "answer": "..." }
//   503               { "error": "model_unavailable" }   (Apple Intelligence off / not ready)
//
// The app's server already did auth + intent + retrieval; this service ONLY
// turns the supplied system prompt + context into a short answer with the
// on-device model. It never reaches into the database and never sees a chat.
//
// Bind to localhost and reach it from the Node side over the existing
// tunnel/loopback — do not expose it publicly. See README.md.

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

app.post("assistant") { req async throws -> AskResponse in
    let body = try req.content.decode(AskRequest.self)

    // Availability gates on: Apple-Intelligence-eligible device, the setting
    // enabled, and the model downloaded. On a headless mini this must run in a
    // logged-in GUI session with Apple Intelligence turned on.
    let model = SystemLanguageModel.default
    guard case .available = model.availability else {
        throw Abort(.serviceUnavailable, reason: "model_unavailable")
    }

    // Instructions carry the system prompt; the turn carries context + question.
    // Apple's on-device context window is small, so the app already trims the
    // context to a handful of records before it gets here.
    let session = LanguageModelSession(instructions: body.system)
    let prompt = """
    Context records (answer only from these):
    \(body.context)

    Question: \(body.question)
    """

    let result = try await session.respond(to: prompt)
    return AskResponse(answer: result.content)
}

try await app.execute()
