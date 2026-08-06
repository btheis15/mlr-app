// Keep the external drive a full backup of the SSD.
//
// A RECONCILING sweep, not a queue: each pass walks the hot volume and copies
// anything the cold volume is missing (or has at a different size). There is no
// pending-work table, no retry list, and no state to get out of sync — if the
// drive was unplugged for a week, the next pass simply finds more to do. Same
// shape as search-indexer.js and the thumbnail/captured-at backfills.
//
// WHAT THIS DOES NOT DO
//
// 1. It never deletes from cold. A backup that prunes itself isn't a backup, and
//    once hot-tier eviction ships, the cold copy is precisely what a request
//    falls through to after the SSD copy is dropped — pruning it would destroy
//    the file. Consequence, deliberate: media deleted from the app lingers on the
//    backup drive. The one exception is an explicit moderation delete, which
//    unlinks from BOTH volumes at the call site (see deleteFileEverywhere in
//    server.js) precisely because "remove this content" has to mean everywhere.
//
// 2. It never evicts from hot. Nothing leaves the SSD until the library actually
//    approaches its allowance, and that policy is a separate change — there is
//    intentionally no unlink-from-hot code in the tree yet.
//
// Copies are atomic per file (temp name on the destination volume, then rename)
// and size-verified, so a drive yanked mid-copy leaves a discarded .part file
// rather than a truncated "backup" that looks complete.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const tiers = require("./media-tiers");
const { TRASH_SUBDIR } = require("./media-trash");

const SWEEP_MS = 10 * 60_000;
const MAX_FILES_PER_SWEEP = 500;
const MAX_BYTES_PER_SWEEP = 4 * 1024 * 1024 * 1024; // 4 GB, so one huge backlog spreads over passes
const CONCURRENCY = 3;

/** Every file under `dir`, as media-root-relative paths. */
async function listRelFiles(dir) {
  const out = [];
  const stack = [""];
  while (stack.length) {
    const relDir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(path.join(dir, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      // Never mirror the quarantine area — it holds media on its way OUT.
      if (e.name === TRASH_SUBDIR) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) out.push(rel);
    }
  }
  return out;
}

/** Copy one file hot→cold: temp file on the destination, verify size, rename. */
async function mirrorOne(rel) {
  const src = tiers.hotPathFor(rel);
  const dest = tiers.coldPathFor(rel);
  if (!dest) return { ok: false, bytes: 0 };

  const srcStat = await fsp.stat(src);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part-${process.pid}`;
  try {
    await fsp.copyFile(src, tmp);
    const copied = await fsp.stat(tmp);
    if (copied.size !== srcStat.size) throw new Error(`size mismatch (${copied.size} vs ${srcStat.size})`);
    await fsp.rename(tmp, dest); // same volume → atomic
    return { ok: true, bytes: srcStat.size };
  } catch (e) {
    try {
      await fsp.unlink(tmp);
    } catch {
      /* nothing to clean up */
    }
    throw e;
  }
}

/**
 * One reconciliation pass. Returns a summary so the caller can log it.
 * Safe to call concurrently with uploads — a file being written right now just
 * gets picked up on a later pass.
 */
async function sweepOnce() {
  if (!tiers.COLD_DIR) return { skipped: "no MEDIA_COLD_DIR configured" };
  if (!tiers.coldReady()) return { skipped: "backup volume not mounted" };

  const hotFiles = await listRelFiles(tiers.HOT_DIR);
  const todo = [];
  let scanned = 0;

  for (const rel of hotFiles) {
    scanned += 1;
    if (rel.includes(".part-")) continue; // an interrupted copy, not real media
    const dest = tiers.coldPathFor(rel);
    if (!dest) continue;
    let need = false;
    try {
      const [srcStat, destStat] = await Promise.all([fsp.stat(tiers.hotPathFor(rel)), fsp.stat(dest)]);
      need = srcStat.size !== destStat.size; // present but wrong size → re-copy
    } catch {
      need = true; // missing on cold (or unreadable) → copy
    }
    if (need) todo.push(rel);
    if (todo.length >= MAX_FILES_PER_SWEEP) break;
  }

  let copied = 0;
  let bytes = 0;
  let failed = 0;
  let queue = todo.slice();

  const worker = async () => {
    while (queue.length) {
      if (bytes >= MAX_BYTES_PER_SWEEP) return;
      const rel = queue.shift();
      if (!rel) return;
      if (!tiers.coldReady()) {
        queue = []; // drive vanished mid-sweep — stop cleanly, resume next pass
        return;
      }
      try {
        const r = await mirrorOne(rel);
        if (r.ok) {
          copied += 1;
          bytes += r.bytes;
        }
      } catch (e) {
        failed += 1;
        console.warn(`[mirror] ${rel}: ${e && e.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { scanned, pending: todo.length, copied, bytes, failed, more: todo.length >= MAX_FILES_PER_SWEEP };
}

function startMirrorSweep() {
  if (!tiers.COLD_DIR) {
    console.log("[mirror] disabled (MEDIA_COLD_DIR not set) — media has NO backup copy");
    return null;
  }
  const run = async () => {
    try {
      const r = await sweepOnce();
      if (r.skipped) {
        console.log(`[mirror] skipped: ${r.skipped}`);
        return;
      }
      if (r.copied || r.failed) {
        const mb = (r.bytes / 1024 / 1024).toFixed(1);
        console.log(
          `[mirror] backed up ${r.copied} file(s), ${mb} MB${r.failed ? `, ${r.failed} failed` : ""}` +
            `${r.more ? " (more next pass)" : ""}`
        );
      }
    } catch (e) {
      console.error(`[mirror] sweep error: ${e && e.message}`);
    }
  };
  void run();
  const timer = setInterval(() => void run(), SWEEP_MS);
  timer.unref?.();
  console.log(`[mirror] backing up ${tiers.HOT_DIR} → ${tiers.COLD_DIR} every ${SWEEP_MS / 60000}m`);
  return timer;
}

/**
 * Delete a media-root-relative file from EVERY volume, for the moderation
 * "actually delete this" path. Returns how many copies were removed.
 *
 * Without this, removing genuinely inappropriate content would unlink the hot
 * copy while leaving it sitting on the backup drive — and the read chain would
 * happily keep serving it from there.
 */
function deleteFileEverywhere(rel) {
  if (!rel || rel.includes("..") || rel.includes("\0")) return 0;
  let removed = 0;
  for (const root of [tiers.HOT_DIR, tiers.COLD_DIR]) {
    if (!root) continue;
    const abs = path.resolve(path.join(root, rel));
    if (!abs.startsWith(path.resolve(root) + path.sep)) continue;
    try {
      fs.unlinkSync(abs);
      removed += 1;
    } catch {
      /* not on this volume, or already gone */
    }
  }
  return removed;
}

module.exports = { startMirrorSweep, sweepOnce, deleteFileEverywhere, listRelFiles };
