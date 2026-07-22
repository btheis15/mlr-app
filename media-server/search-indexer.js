// Semantic-search indexer (runs on the mini, alongside the other media-server
// side-jobs). Keeps ONE shared embedding per piece of content — posts, post
// comments, committee messages, house messages — in the locked
// content_embeddings table (migration 0129). Search-time RLS (the
// search_conversations RPC) is what scopes results per user, so the indexer
// embeds EVERYTHING once, using the service-role client (RLS-bypassing) — it is
// NOT the security boundary, the RPC is.
//
// Strategy: a reconcile sweep on a timer (default every 2 min, first ~20s after
// boot). Each sweep, per source table:
//   1. read the current rows that have text (skipping soft-deleted where the
//      table has deleted_at),
//   2. read the existing (source_id → content_hash) we've already embedded,
//   3. embed only the NEW or EDITED rows (hash changed) via embed-service,
//      upsert their vectors,
//   4. delete embeddings whose source row is gone or was soft-deleted (orphans).
// So a steady state does near-zero work; a fresh install backfills everything on
// the first few sweeps. At this app's scale (thousands of short messages) the
// per-sweep reads are trivial.
//
// Self-contained + never throws out: embed-service down or a Supabase blip just
// logs and retries next sweep, exactly like moderation-backfill.js.

const crypto = require("crypto");
const { embedTexts, toVectorLiteral, embedHealthy, EMBED_URL } = require("./embed-client");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const FIRST_SWEEP_MS = Number(process.env.SEARCH_INDEX_FIRST_MS || 20 * 1000);
const SWEEP_MS = Number(process.env.SEARCH_INDEX_SWEEP_MS || 2 * 60 * 1000);
const EMBED_BATCH = Number(process.env.SEARCH_INDEX_BATCH || 48); // texts per embed call
const PAGE = 1000; // rows per Supabase read page

// Which surfaces to index. `hasDeleted` marks tables with a soft-delete tombstone
// (committee/house chat); posts + comments have no deleted_at.
const SOURCES = [
  { type: "post", table: "posts", hasDeleted: false },
  { type: "post_comment", table: "post_comments", hasDeleted: false },
  { type: "committee_message", table: "committee_messages", hasDeleted: true },
  { type: "house_message", table: "house_messages", hasDeleted: true },
];

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

let _sb = null;
function sb() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!_sb) {
    const { createClient } = require("@supabase/supabase-js");
    _sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _sb;
}

// Page through a table selecting id + text (+ deleted_at guard). Returns Map(id → trimmed text).
async function loadLiveRows(client, src) {
  const live = new Map();
  for (let from = 0; ; from += PAGE) {
    let q = client.from(src.table).select("id, text").not("text", "is", null).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (src.hasDeleted) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      const t = (r.text || "").trim();
      if (t) live.set(r.id, t);
    }
    if (data.length < PAGE) break;
  }
  return live;
}

// Existing embeddings for this source type: Map(source_id → content_hash).
async function loadExistingHashes(client, type) {
  const existing = new Map();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("content_embeddings")
      .select("source_id, content_hash")
      .eq("source_type", type)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) existing.set(r.source_id, r.content_hash);
    if (data.length < PAGE) break;
  }
  return existing;
}

async function reconcileSource(client, src) {
  const live = await loadLiveRows(client, src);
  const existing = await loadExistingHashes(client, src.type);

  // New or edited rows (hash changed / missing).
  const pending = [];
  for (const [id, text] of live) {
    const h = hashText(text);
    if (existing.get(id) !== h) pending.push({ id, text, hash: h });
  }
  // Orphans: we have an embedding but the row is gone or now soft-deleted.
  const orphans = [];
  for (const id of existing.keys()) if (!live.has(id)) orphans.push(id);

  let embedded = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const batch = pending.slice(i, i + EMBED_BATCH);
    const vecs = await embedTexts(batch.map((b) => b.text)); // may throw → caught by caller, retried next sweep
    const rows = [];
    batch.forEach((b, j) => {
      const v = vecs[j];
      if (v && v.length) {
        rows.push({
          source_type: src.type,
          source_id: b.id,
          content_hash: b.hash,
          embedding: toVectorLiteral(v),
          updated_at: new Date().toISOString(),
        });
      }
    });
    if (rows.length) {
      const { error } = await client.from("content_embeddings").upsert(rows, { onConflict: "source_type,source_id" });
      if (error) throw error;
      embedded += rows.length;
    }
  }

  let removed = 0;
  for (let i = 0; i < orphans.length; i += 200) {
    const chunk = orphans.slice(i, i + 200);
    const { error } = await client.from("content_embeddings").delete().eq("source_type", src.type).in("source_id", chunk);
    if (!error) removed += chunk.length;
  }

  return { type: src.type, live: live.size, embedded, removed };
}

let sweeping = false;
async function sweepOnce() {
  if (sweeping) return; // never overlap sweeps
  const client = sb();
  if (!client) return;
  sweeping = true;
  try {
    let totalEmbedded = 0;
    let totalRemoved = 0;
    for (const src of SOURCES) {
      try {
        const r = await reconcileSource(client, src);
        totalEmbedded += r.embedded;
        totalRemoved += r.removed;
        if (r.embedded || r.removed) {
          console.log(`[search-index] ${r.type}: +${r.embedded} embedded, -${r.removed} orphaned (of ${r.live} live)`);
        }
      } catch (e) {
        // e.g. embed-service down, or content_embeddings table not migrated yet.
        console.warn(`[search-index] ${src.type} sweep error (will retry): ${e && e.message}`);
      }
    }
    if (totalEmbedded || totalRemoved) {
      console.log(`[search-index] sweep done: +${totalEmbedded} embedded, -${totalRemoved} removed`);
    }
  } finally {
    sweeping = false;
  }
}

function start() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.warn("[search-index] not started (SUPABASE_URL / SERVICE key missing)");
    return;
  }
  embedHealthy().then((ok) => {
    console.log(
      `[search-index] armed — embed-service ${ok ? "reachable" : "NOT reachable yet"} at ${EMBED_URL}; ` +
        `first sweep in ${Math.round(FIRST_SWEEP_MS / 1000)}s, then every ${Math.round(SWEEP_MS / 60000)}m`
    );
  });
  const run = () => sweepOnce().catch((e) => console.warn(`[search-index] sweep error: ${e && e.message}`));
  setTimeout(run, FIRST_SWEEP_MS);
  setInterval(run, SWEEP_MS);
}

module.exports = { start, sweepOnce, reconcileSource };
