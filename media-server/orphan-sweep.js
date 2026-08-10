// Reconcile disk against the database: quarantine media nothing references.
//
// Deleting a photo in the app removes its *_media ROW; the FILE was never
// touched, so every photo ever deleted was still on disk (a hard-deleted album
// left 438 photos behind). Rather than wiring a file-delete into each of the many
// delete paths (member remove, admin remove, RPC, cascade from deleting a whole
// drop box, iOS), this reconciles the two sides periodically — so a deletion from
// ANY surface is picked up, and a missed event just means the next pass catches it.
// Same idea as search-indexer.js and the thumbnail/captured-at backfills.
//
// ⚠️⚠️ THIS IS THE MOST DANGEROUS JOB IN THE SERVER. It decides that irreplaceable
// family photos are unreferenced and removes them. A bug, a half-finished query,
// or one forgotten table means real photos disappear. Hence: it quarantines rather
// than deletes (media-trash.js, 7-day hold), and every safeguard below is
// load-bearing. If you add a table that stores a /f/ URL, ADD IT TO REF_TABLES —
// a missing table orphans that whole feature's media.

const fsp = require("fs/promises");
const path = require("path");
const tiers = require("./media-tiers");
const trash = require("./media-trash");

// Every table holding a mini /f/ URL. Mirrors MEDIA_URL_TABLES in server.js —
// keep them in step. Verified complete by grepping every uploadToMini() caller.
const REF_TABLES = [
  "post_media",
  "post_comment_media",
  "work_item_media",
  "drop_box_media",
  "committee_message_media",
  "house_message_media",
];
// Columns on those tables that can hold a URL. thumbnail_url matters as much as
// storage_path — a thumbnail is referenced only there.
const URL_COLUMNS = ["storage_path", "thumbnail_url"];

const SWEEP_MS = Number(process.env.ORPHAN_SWEEP_MS || 6 * 60 * 60 * 1000); // 6h
const FIRST_SWEEP_MS = Number(process.env.ORPHAN_SWEEP_FIRST_MS || 10 * 60 * 1000); // 10m after boot
// A file younger than this is never touched: the client inserts its *_media row
// AFTER /upload returns, so a brand-new file legitimately has no row yet.
const GRACE_HOURS = Number(process.env.ORPHAN_GRACE_HOURS || 48);
// Refuse to run if fewer than this fraction of files look referenced. A partial
// or silently-empty query would otherwise mark most of the library as orphaned.
const MIN_REFERENCED_FRACTION = Number(process.env.ORPHAN_MIN_REF_FRACTION || 0.25);
const MAX_QUARANTINE_PER_SWEEP = Number(process.env.ORPHAN_MAX_PER_SWEEP || 2000);

const PAGE = 1000;

function relFromUrl(url) {
  if (typeof url !== "string") return null;
  const i = url.indexOf("/f/");
  if (i === -1) return null;
  let rel = url.slice(i + 3).split("?")[0];
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep the raw form */
  }
  return rel || null;
}

/**
 * Every referenced path, as both full relative paths and bare basenames.
 *
 * ⚠️ The basename set exists for LEGACY FLAT URLS: rows saved before uploads were
 * filed by feature+month store ".../f/<uuid>.<ext>" while the file actually lives
 * at posts/legacy/<uuid>.<ext>. Matching on relative path alone would mark every
 * legacy file unreferenced and quarantine the app's oldest photos. Over-retaining
 * is the only acceptable direction of error here.
 *
 * @throws on ANY read failure — the caller must abort rather than sweep with a
 *         partial picture.
 */
async function collectReferences(admin) {
  const rels = new Set();
  const bases = new Set();
  let rows = 0;

  for (const table of REF_TABLES) {
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from(table)
        .select(URL_COLUMNS.join(","))
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!Array.isArray(data)) throw new Error(`${table}: unexpected payload`);
      for (const row of data) {
        rows += 1;
        for (const col of URL_COLUMNS) {
          const rel = relFromUrl(row[col]);
          if (!rel) continue;
          rels.add(rel);
          bases.add(path.basename(rel));
        }
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  return { rels, bases, rows };
}

/** Every file under a volume, skipping the quarantine area and dotfiles. */
async function listVolume(root) {
  const out = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (trash.isTrashPath(r)) continue; // never treat quarantine as media
      if (e.isDirectory()) {
        stack.push(r);
        continue;
      }
      if (!e.isFile()) continue;
      if (r.includes(".part-")) continue; // an interrupted mirror copy
      let st;
      try {
        st = await fsp.stat(path.join(root, r));
      } catch {
        continue;
      }
      out.push({ rel: r, name: e.name, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

// Derived files that belong to a parent object rather than to a database row.
// Each is named `<uuid><suffix>.<ext>` beside the object it belongs to, and NONE
// of them is referenced by any *_media row — so without this they'd all look like
// orphans and be quarantined:
//   _thumb  the grid preview
//   _orig   ⭐ the untouched full-quality upload, kept beside its streamable
//           rendition. Quarantining these would silently delete exactly the
//           irreplaceable files the whole preserve-originals change exists to keep.
const DERIVED_SUFFIXES = ["_thumb", "_orig"];

function isReferenced(file, refs) {
  if (refs.rels.has(file.rel)) return true;
  if (refs.bases.has(file.name)) return true; // legacy flat URL

  // A derived file lives or dies with its parent object. Match on the stem so a
  // `.mov` original behind an `.mp4` rendition still resolves.
  const stemNoExt = file.name.slice(0, file.name.length - path.extname(file.name).length);
  for (const suffix of DERIVED_SUFFIXES) {
    if (!stemNoExt.endsWith(suffix)) continue;
    const parentStem = stemNoExt.slice(0, -suffix.length);
    if (!parentStem) continue;
    for (const b of refs.bases) {
      if (b.slice(0, b.length - path.extname(b).length) === parentStem) return true;
    }
  }
  return false;
}

/**
 * One pass. `dryRun` reports what it WOULD quarantine and touches nothing.
 * @returns a summary, or { aborted: reason } when a safeguard tripped.
 */
async function sweepOnce({ admin, dryRun = false, now = Date.now() } = {}) {
  if (!admin) return { aborted: "no service-role client" };

  let refs;
  try {
    refs = await collectReferences(admin);
  } catch (e) {
    // FAIL CLOSED. A partial reference set is indistinguishable from "these
    // files are orphaned", so we must not proceed.
    return { aborted: `could not read every reference table (${e.message})` };
  }

  const volumes = [{ tier: "hot", root: tiers.HOT_DIR }];
  if (tiers.coldReady()) volumes.push({ tier: "cold", root: tiers.COLD_DIR });

  const seen = new Map(); // rel -> file (union across volumes, one decision per path)
  let scanned = 0;
  let referenced = 0;
  for (const v of volumes) {
    for (const f of await listVolume(v.root)) {
      scanned += 1;
      if (isReferenced(f, refs)) {
        referenced += 1;
        continue;
      }
      if (!seen.has(f.rel)) seen.set(f.rel, f);
    }
  }

  // Sanity floor: if barely anything looks referenced, something is wrong with
  // the query side, not with the library.
  const fraction = scanned ? referenced / scanned : 1;
  if (scanned > 0 && fraction < MIN_REFERENCED_FRACTION) {
    return {
      aborted:
        `only ${(fraction * 100).toFixed(1)}% of ${scanned} files matched a database row ` +
        `(floor ${(MIN_REFERENCED_FRACTION * 100).toFixed(0)}%) — refusing to quarantine, check REF_TABLES`,
      scanned,
      referenced,
    };
  }

  const cutoff = now - GRACE_HOURS * 3600 * 1000;
  const candidates = [...seen.values()].filter((f) => f.mtimeMs <= cutoff);
  const tooNew = seen.size - candidates.length;
  const batch = trash.batchName(now);

  if (dryRun) {
    return {
      dryRun: true,
      scanned,
      referenced,
      wouldQuarantine: candidates.length,
      bytes: candidates.reduce((s, f) => s + f.size, 0),
      tooNew,
      sample: candidates.sort((a, b) => b.size - a.size).slice(0, 10).map((f) => ({ rel: f.rel, size: f.size })),
    };
  }

  let moved = 0;
  let bytes = 0;
  let failed = 0;
  for (const f of candidates.slice(0, MAX_QUARANTINE_PER_SWEEP)) {
    try {
      const r = await trash.quarantine(f.rel, batch);
      if (r.removedFrom.length) {
        moved += 1;
        bytes += r.bytes;
      }
    } catch (e) {
      failed += 1;
      console.warn(`[orphan] could not quarantine ${f.rel}: ${e && e.message}`);
    }
  }

  let purged = { purged: 0 };
  try {
    purged = await trash.purgeExpired(now);
  } catch (e) {
    console.warn(`[orphan] purge failed: ${e && e.message}`);
  }

  return { scanned, referenced, moved, bytes, failed, tooNew, batch, purgedBatches: purged.purged };
}

function startOrphanSweep(deps) {
  if (!deps || !deps.admin) {
    console.log("[orphan] not started (missing service-role client)");
    return null;
  }
  const run = async () => {
    try {
      const r = await sweepOnce({ admin: deps.admin });
      if (r.aborted) {
        console.warn(`[orphan] sweep ABORTED: ${r.aborted}`);
        return;
      }
      if (r.moved || r.failed || r.purgedBatches) {
        console.log(
          `[orphan] quarantined ${r.moved} unreferenced file(s), ${(r.bytes / 1048576).toFixed(1)} MB` +
            `${r.failed ? `, ${r.failed} failed` : ""}` +
            `${r.purgedBatches ? `, purged ${r.purgedBatches} expired batch(es)` : ""}`
        );
      }
    } catch (e) {
      console.error(`[orphan] sweep error: ${e && e.message}`);
    }
  };
  setTimeout(() => {
    void run();
    setInterval(() => void run(), SWEEP_MS).unref?.();
  }, FIRST_SWEEP_MS).unref?.();
  console.log(
    `[orphan] armed — first sweep in ${Math.round(FIRST_SWEEP_MS / 60000)}m, then every ` +
      `${Math.round(SWEEP_MS / 3600000)}h; unreferenced media is quarantined for ${trash.RETENTION_DAYS} days`
  );
  return true;
}

module.exports = { startOrphanSweep, sweepOnce, collectReferences, listVolume, isReferenced, REF_TABLES };
