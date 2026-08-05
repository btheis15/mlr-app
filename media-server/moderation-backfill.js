// Deferred re-moderation queue.
//
// Moderation is FAIL-OPEN: when the model can't be reached (PCC quota exhausted,
// fm serve down, a transient error that outlived the retries), moderateMedia()
// returns null and the upload goes through UNCHECKED. Without this, that item
// would stay unchecked forever — so anything posted during an outage escapes.
//
// This closes that gap: every fail-open upload is enqueued (persisted to disk so
// it survives a restart) and re-checked on a timer. When the model comes back
// (e.g. quota resets), the sweep re-runs moderateMedia on the still-on-disk file;
// a clean verdict just drops it from the queue, and a FLAGGED verdict records it
// to media_moderation — whose trigger (migration 0128) then RETROACTIVELY holds
// the already-posted post/message, exactly like the async chat path. So "resume
// when usage resets" is automatic and covers the outage window too.
//
// Self-contained + never throws: a bad queue file, a missing media file, or a
// model error can't take down the server.

const fs = require("fs");
const path = require("path");

const QUEUE_FILE = path.join(__dirname, ".mod-recheck.json");
const SWEEP_MS = Number(process.env.MOD_RECHECK_MS || 15 * 60 * 1000); // 15 min
const FIRST_SWEEP_MS = Number(process.env.MOD_RECHECK_FIRST_MS || 90 * 1000); // 90s after boot
const MAX_ATTEMPTS = Number(process.env.MOD_RECHECK_MAX_ATTEMPTS || 10); // give up after N tries
// 200 was far too many: a photo the model can never handle was re-scanned 200
// times (x up to 9 requests each), burning a limited PCC quota for days on one
// file. 10 is plenty to ride out a real outage (sweeps run every 15m, so ~2.5h)
// while capping the damage from anything permanently unanalyzable.
const MAX_AGE_MS = Number(process.env.MOD_RECHECK_MAX_AGE_MS || 14 * 24 * 60 * 60 * 1000); // 14 days
const PER_SWEEP = Number(process.env.MOD_RECHECK_PER_SWEEP || 25); // items processed per tick

// items: [{ url, relPath, kind, category, attempts, firstAt, lastAt }]
let queue = [];
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
      if (Array.isArray(raw)) queue = raw;
    }
  } catch (e) {
    console.warn(`[recheck] couldn't read queue (${e.message}) — starting empty`);
    queue = [];
  }
}

function persist() {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue));
  } catch (e) {
    console.warn(`[recheck] couldn't persist queue: ${e.message}`);
  }
}

// ── Running totals, for the owner-only Media server card ─────────────────────
// The queue only knows what's still PENDING — once an item resolves it's dropped,
// so nothing recorded how many had ever been scanned. These counters are the
// durable tally (own file, so a queue rewrite can't clobber them), plus the list
// of items that gave up so the owner can approve/remove them by hand instead of
// the sweep retrying forever.
const STATS_FILE = path.join(__dirname, ".mod-stats.json");
const MAX_GAVE_UP = 200; // keep the most recent N; this is a review list, not an audit log
let stats = { scanned: 0, flagged: 0, gaveUp: [] };
let statsLoaded = false;

function loadStats() {
  if (statsLoaded) return;
  statsLoaded = true;
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
      stats = {
        scanned: Number(raw.scanned) || 0,
        flagged: Number(raw.flagged) || 0,
        gaveUp: Array.isArray(raw.gaveUp) ? raw.gaveUp : [],
      };
    }
  } catch {
    /* corrupt file → start fresh rather than crash the sweep */
  }
}

function persistStats() {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
  } catch (e) {
    console.warn(`[recheck] couldn't persist stats: ${e.message}`);
  }
}

/** What the owner-only Media server card shows. */
function moderationStats() {
  load();
  loadStats();
  return {
    scanned: stats.scanned,
    flagged: stats.flagged,
    pending: queue.length,
    gaveUp: stats.gaveUp.slice(-MAX_GAVE_UP).reverse(), // newest first
  };
}

/** Drop an item from the give-up list once the owner has dealt with it. */
function clearGaveUp(url) {
  loadStats();
  const before = stats.gaveUp.length;
  stats.gaveUp = stats.gaveUp.filter((g) => g.url !== url);
  if (stats.gaveUp.length !== before) persistStats();
  return before - stats.gaveUp.length;
}

/**
 * A photo the model DECLINED to analyze. Left visible (see moderation.js — a
 * refusal is weak evidence and fires on ordinary photos), but recorded here so
 * it lands in the owner's For-review list, and reported back so the caller can
 * fire the owner a push. Deduped by url.
 *
 * Returns true the first time a given url is added, so the caller only notifies
 * once per photo.
 */
function noteNeedsReview({ url, relPath, kind, reason }) {
  if (!url) return false;
  loadStats();
  if (stats.gaveUp.some((g) => g.url === url)) return false;
  stats.gaveUp.push({
    url,
    relPath: relPath || "",
    kind: kind || "image",
    reason: reason || "couldn't be scanned",
    unscannable: true,
    at: new Date().toISOString(),
  });
  if (stats.gaveUp.length > MAX_GAVE_UP) stats.gaveUp = stats.gaveUp.slice(-MAX_GAVE_UP);
  persistStats();
  console.log(`[moderate] ${relPath || url} → needs a human look (left visible, ${stats.gaveUp.length} in the review list)`);
  return true;
}

// Enqueue a fail-open upload for later re-checking. Deduped by URL. `relPath` is
// the path relative to MEDIA_DIR (so it survives an absolute-path/dir change).
function enqueueRecheck({ url, relPath, kind, category }) {
  if (!url || !relPath) return;
  load();
  if (queue.some((q) => q.url === url)) return;
  const nowIso = new Date().toISOString();
  queue.push({ url, relPath, kind: kind || "image", category: category || "posts", attempts: 0, firstAt: nowIso, lastAt: null });
  persist();
  console.log(`[recheck] queued ${relPath} (${queue.length} pending re-check)`);
}

// One pass over the queue. `deps` = { moderateMedia, recordMediaModeration, mediaDir }.
async function sweepOnce(deps) {
  load();
  if (!queue.length) return;
  const { moderateMedia, recordMediaModeration, mediaDir } = deps;
  const now = Date.now();
  const batch = queue.slice(0, PER_SWEEP);
  const drop = new Set();
  let checked = 0;
  let flagged = 0;

  for (const item of batch) {
    const abs = path.join(mediaDir, item.relPath);
    // File gone (deleted/moved) → nothing to check, drop it.
    if (!fs.existsSync(abs)) { drop.add(item.url); continue; }
    // Aged out or too many tries → give up (member reports + admin queue remain
    // the backstop). Logged so a persistent outage is visible.
    if (item.attempts >= MAX_ATTEMPTS || (item.firstAt && now - Date.parse(item.firstAt) > MAX_AGE_MS)) {
      console.warn(`[recheck] giving up on ${item.relPath} after ${item.attempts} tries`);
      // Remember it so the owner can approve/remove it by hand — otherwise a
      // file that could never be scanned just vanished silently, unreviewed.
      loadStats();
      stats.gaveUp.push({
        url: item.url,
        relPath: item.relPath,
        kind: item.kind,
        attempts: item.attempts,
        firstAt: item.firstAt,
        lastAt: item.lastAt,
        at: new Date().toISOString(),
      });
      if (stats.gaveUp.length > MAX_GAVE_UP) stats.gaveUp = stats.gaveUp.slice(-MAX_GAVE_UP);
      persistStats();
      drop.add(item.url);
      continue;
    }
    let v = null;
    try {
      v = await moderateMedia(abs, item.kind);
    } catch (e) {
      console.warn(`[recheck] ${item.relPath} error: ${e.message}`);
    }
    if (v) {
      checked++;
      loadStats();
      stats.scanned++;
      if (v.flagged) stats.flagged++;
      persistStats();
      if (v.flagged) {
        flagged++;
        console.log(`[recheck] ${item.relPath} → FLAGGED ${v.category} — recording (retroactive hold)`);
        try { await recordMediaModeration(item.url, v); } catch (e) { console.warn(`[recheck] record failed: ${e.message}`); }
      }
      drop.add(item.url); // resolved (clean or flagged) → done
    } else {
      // Still can't check (model unavailable) — bump attempts, try next sweep.
      item.attempts++;
      item.lastAt = new Date().toISOString();
    }
  }

  if (drop.size) queue = queue.filter((q) => !drop.has(q.url));
  persist();
  if (checked || flagged || drop.size) {
    console.log(`[recheck] sweep: ${checked} checked (${flagged} flagged), ${queue.length} still pending`);
  }
}

// Start the periodic re-check. No-op scheduling if deps are missing.
function startBackfill(deps) {
  if (!deps || !deps.moderateMedia || !deps.recordMediaModeration || !deps.mediaDir) {
    console.warn("[recheck] backfill not started (missing deps)");
    return;
  }
  load();
  console.log(`[recheck] backfill armed — ${queue.length} pending, sweep every ${Math.round(SWEEP_MS / 60000)}m`);
  const run = () => { sweepOnce(deps).catch((e) => console.warn(`[recheck] sweep error: ${e.message}`)); };
  setTimeout(run, FIRST_SWEEP_MS);
  setInterval(run, SWEEP_MS);
}

module.exports = { enqueueRecheck, startBackfill, sweepOnce, moderationStats, clearGaveUp, noteScanned, noteNeedsReview };

/** Count a scan that happened OUTSIDE the sweep (the inline/async upload path),
 *  so the owner's totals cover all scanning, not just re-checks. */
function noteScanned(flagged) {
  loadStats();
  stats.scanned++;
  if (flagged) stats.flagged++;
  persistStats();
}
