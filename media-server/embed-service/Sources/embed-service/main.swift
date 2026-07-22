// MLR embed-service — on-device text embeddings for semantic search.
//
// Contract:
//   GET  /health                 -> 200 { ok: true, model, dim }
//   POST /embed  { texts: [..] }  -> 200 { model, dim, vectors: [[Float], ...] }
//   POST /embed  { text: ".." }   -> 200 { model, dim, vectors: [[Float]] }
//     • Each vector is mean-pooled over token vectors, then L2-normalized, so
//       cosine similarity == dot product. Length == dim (512).
//     • A text that can't be embedded (empty / all-punctuation) yields an EMPTY
//       array in that slot — the caller skips it (never store a zero vector,
//       it pollutes similarity).
//   401 when EMBED_SHARED_SECRET is set and the X-EMBED-TOKEN header doesn't match.
//
// It NEVER reaches the database and never sees who is searching — it only turns
// strings into numbers. RLS-scoped retrieval happens back in Postgres (see the
// search_conversations RPC). Bind to loopback; media-server is the only caller.
//
// Why NaturalLanguage and not "Apple Intelligence"/FoundationModels: the FM LLM
// (fm serve) has no embeddings endpoint, and its on-device generation SIGTRAPs
// on this macOS 27 beta. NLContextualEmbedding is a separate, stable subsystem —
// verified working on this exact build.

import Foundation
import Vapor
import NaturalLanguage

// MARK: - Model (loaded once, kept resident)

guard let embModel = NLContextualEmbedding(language: .english) else {
    FileHandle.standardError.write(Data("FATAL: NLContextualEmbedding unavailable for English\n".utf8))
    exit(1)
}
if !embModel.hasAvailableAssets {
    // First-run asset fetch (blocking). Normally already present on the mini.
    let sem = DispatchSemaphore(value: 0)
    embModel.requestAssets { _, _ in sem.signal() }
    _ = sem.wait(timeout: .now() + 180)
}
do { try embModel.load() } catch {
    FileHandle.standardError.write(Data("FATAL: model load failed: \(error)\n".utf8))
    exit(1)
}
let DIM = embModel.dimension
let MODEL_ID = "nl-contextual-en.r\(embModel.revision)"

// NLContextualEmbedding is not documented thread-safe; serialize access. The
// work is CPU/ANE-bound and effectively one-at-a-time anyway, and the callers
// (batch indexing, single-query search) tolerate serialization fine.
let modelLock = NSLock()

// The model truncates at maxSequenceLength (256) tokens, so long posts would
// lose their tail. Split into windows on sentence boundaries and average the
// per-window vectors so the WHOLE text contributes.
let MAX_CHUNK_CHARS = 900

func chunk(_ text: String) -> [String] {
    if text.count <= MAX_CHUNK_CHARS { return [text] }
    let tok = NLTokenizer(unit: .sentence)
    tok.string = text
    var parts: [String] = []
    var cur = ""
    tok.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
        let s = String(text[range])
        if cur.count + s.count > MAX_CHUNK_CHARS && !cur.isEmpty {
            parts.append(cur); cur = s
        } else {
            cur += s
        }
        return true
    }
    if !cur.isEmpty { parts.append(cur) }
    // Hard-split any single monster sentence that still exceeds the budget.
    var out: [String] = []
    for p in parts {
        if p.count <= MAX_CHUNK_CHARS { out.append(p); continue }
        var idx = p.startIndex
        while idx < p.endIndex {
            let end = p.index(idx, offsetBy: MAX_CHUNK_CHARS, limitedBy: p.endIndex) ?? p.endIndex
            out.append(String(p[idx..<end]))
            idx = end
        }
    }
    return out
}

// Mean-pool the token vectors for one window (un-normalized).
func poolWindow(_ text: String) -> [Double]? {
    guard let result = try? embModel.embeddingResult(for: text, language: .english) else { return nil }
    var pooled = [Double](repeating: 0, count: DIM)
    var n = 0
    result.enumerateTokenVectors(in: text.startIndex..<text.endIndex) { (vec, _) -> Bool in
        let m = min(vec.count, DIM)
        for i in 0..<m { pooled[i] += vec[i] }
        n += 1
        return true
    }
    guard n > 0 else { return nil }
    for i in 0..<DIM { pooled[i] /= Double(n) }
    return pooled
}

// Full pipeline for one input: chunk -> pool each window -> average -> L2-normalize.
// Returns [] when there's nothing embeddable.
func embed(_ raw: String) -> [Float] {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return [] }
    var acc = [Double](repeating: 0, count: DIM)
    var windows = 0
    for part in chunk(text) {
        guard let v = poolWindow(part) else { continue }
        for i in 0..<DIM { acc[i] += v[i] }
        windows += 1
    }
    guard windows > 0 else { return [] }
    var norm = 0.0
    for i in 0..<DIM { acc[i] /= Double(windows); norm += acc[i] * acc[i] }
    norm = norm.squareRoot()
    guard norm > 1e-9 else { return [] }
    return acc.map { Float($0 / norm) }
}

// MARK: - HTTP

struct EmbedRequest: Content {
    let texts: [String]?
    let text: String?
}
struct EmbedResponse: Content {
    let model: String
    let dim: Int
    let vectors: [[Float]]
}
struct HealthResponse: Content {
    let ok: Bool
    let model: String
    let dim: Int
}

let app = try await Application.make(.detect())
app.http.server.configuration.hostname = Environment.get("EMBED_HOST") ?? "127.0.0.1"
app.http.server.configuration.port = Int(Environment.get("EMBED_PORT") ?? "8786") ?? 8786
// Indexing can send fat batches; allow a roomy body.
app.routes.defaultMaxBodySize = "16mb"

let requiredSecret = Environment.get("EMBED_SHARED_SECRET").flatMap { $0.isEmpty ? nil : $0 }
func checkSecret(_ req: Request) throws {
    guard let requiredSecret else { return }
    guard req.headers.first(name: "X-EMBED-TOKEN") == requiredSecret else {
        throw Abort(.unauthorized, reason: "unauthorized")
    }
}

app.get("health") { _ in HealthResponse(ok: true, model: MODEL_ID, dim: DIM) }

app.post("embed") { req async throws -> EmbedResponse in
    try checkSecret(req)
    let body = try req.content.decode(EmbedRequest.self)
    let inputs: [String] = body.texts ?? body.text.map { [$0] } ?? []
    guard !inputs.isEmpty else { throw Abort(.badRequest, reason: "provide `texts` (array) or `text` (string)") }
    guard inputs.count <= 512 else { throw Abort(.badRequest, reason: "max 512 texts per request") }

    // Run the CPU-bound embedding off the event loop, serialized by the lock.
    let vectors = try await req.application.threadPool.runIfActive(eventLoop: req.eventLoop) { () -> [[Float]] in
        modelLock.lock()
        defer { modelLock.unlock() }
        return inputs.map { embed($0) }
    }.get()

    return EmbedResponse(model: MODEL_ID, dim: DIM, vectors: vectors)
}

app.logger.notice("embed-service ready — model=\(MODEL_ID) dim=\(DIM) on \(app.http.server.configuration.hostname):\(app.http.server.configuration.port)")
try await app.execute()
