// Thin client for the on-device embedding microservice (embed-service, Swift +
// NaturalLanguage, loopback :8786). Mirrors how moderation.js talks to the local
// `fm serve` — a plain HTTP POST to a localhost service, with the shared-secret
// header. Used by BOTH the search indexer (batch) and the /search endpoint (one
// query). It only turns text into vectors; it never touches the database.
//
// The embed-service returns L2-normalized 512-d vectors; an un-embeddable input
// (empty / all punctuation) comes back as an empty array in that slot, which we
// surface as null so callers skip it (never store a zero vector).

const EMBED_URL = (process.env.EMBED_URL || "http://127.0.0.1:8786").replace(/\/+$/, "");
const EMBED_SECRET = process.env.EMBED_SHARED_SECRET || "";
const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS || 60000);

function authHeaders() {
  return EMBED_SECRET ? { "X-EMBED-TOKEN": EMBED_SECRET } : {};
}

// Embed a batch. Returns an array parallel to `texts`; each entry is a number[]
// (length = model dim) or null if that text couldn't be embedded. Throws if the
// service is unreachable / errors (callers decide whether to retry or fail open).
async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const resp = await fetch(`${EMBED_URL}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ texts }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`embed-service HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = await resp.json();
  const vecs = Array.isArray(data.vectors) ? data.vectors : [];
  return texts.map((_, i) => (Array.isArray(vecs[i]) && vecs[i].length ? vecs[i] : null));
}

async function embedOne(text) {
  const [v] = await embedTexts([text]);
  return v || null;
}

// pgvector text input format: "[0.1,0.2,...]". PostgREST casts this string into
// the `vector` column on write, and into the RPC's vector param on read.
function toVectorLiteral(vec) {
  return "[" + vec.map((x) => (Number.isFinite(x) ? x : 0)).join(",") + "]";
}

// Cheap reachability check (no secret needed — /health is open).
async function embedHealthy() {
  try {
    const r = await fetch(`${EMBED_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

module.exports = { embedTexts, embedOne, toVectorLiteral, embedHealthy, EMBED_URL };
