// Quarantine: a 7-day holding area for media that no longer has a database row.
//
// Deleting a photo in the app removes its *_media ROW but has never removed the
// FILE, so deleted media accumulated on disk indefinitely. The orphan sweep
// (orphan-sweep.js) now reconciles that — but it moves files HERE first and only
// purges after RETENTION_DAYS, so an accidental album deletion is recoverable
// for a week instead of instantly unrecoverable.
//
// ⚠️⚠️ SAFETY BOUNDARY: this module may only ever touch files INSIDE the app's own
// media roots. The external drive holds ~180GB of the owner's unrelated personal
// files, and a bug that walked out of the media folder would be catastrophic and
// irreversible. Every mutating function routes through assertInsideMediaRoot(),
// which resolves the real path and refuses anything not under HOT_DIR/COLD_DIR.
// There is no code path here that takes an arbitrary absolute path and unlinks it.
//
// Layout — deliberately INSIDE the media folder, not a sibling at the drive root,
// so everything this app touches stays under one directory the owner can see:
//
//   <COLD_DIR>/_trash/<batch-iso>/<original media-relative path>
//
// TRASH_SUBDIR is excluded from four things, and all four matter:
//   1. /f serving      — else deleted media would still be downloadable
//   2. the usage walk  — else the storage meter counts trash as app content
//   3. the mirror sweep— else trash would be mirrored as if it were live media
//   4. the orphan sweep— else it would try to quarantine the quarantine, forever

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const tiers = require("./media-tiers");

const TRASH_SUBDIR = "_trash";
const RETENTION_DAYS = Number(process.env.MEDIA_TRASH_RETENTION_DAYS || 7);

/** Quarantine lives on the backup volume when there is one (it has the room),
 *  otherwise beside the hot media so the feature still works in dev. */
function trashRoot() {
  const base = tiers.coldReady() ? tiers.COLD_DIR : tiers.HOT_DIR;
  return path.join(base, TRASH_SUBDIR);
}

/**
 * Resolve `rel` against `root` and prove the result is really inside it.
 * @throws if the path escapes, so a caller can never unlink outside the app.
 */
function assertInsideMediaRoot(root, rel) {
  if (!root) throw new Error("no media root");
  if (typeof rel !== "string" || !rel || rel.includes("\0")) throw new Error(`unsafe relative path: ${rel}`);
  const abs = path.resolve(path.join(root, rel));
  const bound = path.resolve(root) + path.sep;
  if (!abs.startsWith(bound)) throw new Error(`refusing to touch a path outside the media root: ${abs}`);
  return abs;
}

/** True for anything inside the quarantine area (never treat these as media). */
function isTrashPath(rel) {
  if (typeof rel !== "string") return false;
  return rel === TRASH_SUBDIR || rel.startsWith(`${TRASH_SUBDIR}/`) || rel.includes(`/${TRASH_SUBDIR}/`);
}

/**
 * Move one media-relative path into quarantine, removing it from BOTH volumes.
 *
 * ORDER MATTERS — bytes must reach the trash before any unlink, so a crash can
 * never destroy the only copy:
 *   1. If the cold copy exists, RENAME it into trash. Same volume, so this is
 *      instant and atomic — no multi-GB copy for a big video.
 *   2. Otherwise copy the hot file into trash and verify its size.
 *   3. Only then unlink whatever copies remain.
 * If a crash happens after (1), the hot copy still exists and still serves; the
 * next sweep re-quarantines it (idempotent — step 1 unlinks instead of
 * clobbering when the trash target is already there).
 *
 * @returns {{ rel, batch, bytes, removedFrom: string[] }}
 */
async function quarantine(rel, batch) {
  if (isTrashPath(rel)) throw new Error(`refusing to quarantine something already in ${TRASH_SUBDIR}: ${rel}`);

  const dest = assertInsideMediaRoot(trashRoot(), path.join(batch, rel));
  await fsp.mkdir(path.dirname(dest), { recursive: true });

  const hotAbs = assertInsideMediaRoot(tiers.HOT_DIR, rel);
  const coldAbs = tiers.coldReady() ? assertInsideMediaRoot(tiers.COLD_DIR, rel) : null;

  const hotExists = fs.existsSync(hotAbs);
  const coldExists = coldAbs ? fs.existsSync(coldAbs) : false;
  if (!hotExists && !coldExists) return { rel, batch, bytes: 0, removedFrom: [] };

  let bytes = 0;
  try {
    bytes = (await fsp.stat(coldExists ? coldAbs : hotAbs)).size;
  } catch {
    /* size is informational only */
  }

  const removedFrom = [];
  let preserved = fs.existsSync(dest);

  // 1 — preserve bytes via a same-volume rename where possible.
  if (!preserved && coldExists) {
    await fsp.rename(coldAbs, dest);
    preserved = true;
    removedFrom.push("cold");
  }
  // 2 — no cold copy (or trash already held it): copy from hot, verify, then drop.
  if (!preserved && hotExists) {
    const tmp = `${dest}.part-${process.pid}`;
    try {
      await fsp.copyFile(hotAbs, tmp);
      const copied = await fsp.stat(tmp);
      const src = await fsp.stat(hotAbs);
      if (copied.size !== src.size) throw new Error(`size mismatch (${copied.size} vs ${src.size})`);
      await fsp.rename(tmp, dest);
      preserved = true;
    } catch (e) {
      try {
        await fsp.unlink(tmp);
      } catch {
        /* nothing staged */
      }
      throw e; // leave BOTH originals alone — never unlink without a saved copy
    }
  }
  if (!preserved) throw new Error(`could not preserve ${rel} before deleting it`);

  // 3 — bytes are safe in trash; now remove the remaining live copies.
  if (coldExists && !removedFrom.includes("cold")) {
    try {
      await fsp.unlink(coldAbs);
      removedFrom.push("cold");
    } catch {
      /* already gone */
    }
  }
  if (hotExists) {
    try {
      await fsp.unlink(hotAbs);
      removedFrom.push("hot");
    } catch {
      /* already gone */
    }
  }
  return { rel, batch, bytes, removedFrom };
}

/** Batch folder names are ISO-ish and sortable; the date is the purge clock. */
function batchName(now) {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

function batchAgeDays(name, now) {
  // "2026-08-06T14-30-00-000Z" -> parseable ISO
  const iso = name.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z");
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null; // unrecognized folder — never auto-purge it
  return (now - t) / 86400000;
}

/** Permanently remove quarantine batches older than RETENTION_DAYS. */
async function purgeExpired(now = Date.now()) {
  const root = trashRoot();
  let batches;
  try {
    batches = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return { purged: 0, batches: [] };
  }
  const purged = [];
  for (const b of batches) {
    if (!b.isDirectory()) continue;
    const age = batchAgeDays(b.name, now);
    if (age === null || age < RETENTION_DAYS) continue;
    const abs = assertInsideMediaRoot(root, b.name); // boundary check before rm -r
    await fsp.rm(abs, { recursive: true, force: true });
    purged.push({ batch: b.name, ageDays: Math.floor(age) });
  }
  return { purged: purged.length, batches: purged };
}

/** What's currently held, for the admin card / reporting. */
async function trashSummary(now = Date.now()) {
  const root = trashRoot();
  let batches;
  try {
    batches = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return { path: root, batches: 0, files: 0, bytes: 0, nextPurgeInDays: null };
  }
  let files = 0;
  let bytes = 0;
  let soonest = null;
  for (const b of batches) {
    if (!b.isDirectory()) continue;
    const age = batchAgeDays(b.name, now);
    if (age !== null) {
      const left = Math.max(0, RETENTION_DAYS - age);
      if (soonest === null || left < soonest) soonest = left;
    }
    const stack = [path.join(root, b.name)];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) {
          files += 1;
          try {
            bytes += (await fsp.stat(full)).size;
          } catch {
            /* skip */
          }
        }
      }
    }
  }
  return {
    path: root,
    batches: batches.filter((b) => b.isDirectory()).length,
    files,
    bytes,
    retentionDays: RETENTION_DAYS,
    nextPurgeInDays: soonest === null ? null : Math.ceil(soonest),
  };
}

/**
 * Put a quarantined file back. Restores to whichever volume the routing rules
 * say it belongs on (a big video goes back to the external drive), and the mirror
 * sweep re-creates the backup copy on its next pass.
 */
async function restore(batch, rel) {
  const src = assertInsideMediaRoot(trashRoot(), path.join(batch, rel));
  if (!fs.existsSync(src)) throw new Error(`not in quarantine: ${batch}/${rel}`);
  const size = (await fsp.stat(src)).size;
  const choice = tiers.pickUploadRoot(size, null);
  const root = choice.root || tiers.HOT_DIR;
  const dest = assertInsideMediaRoot(root, rel);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
  if ((await fsp.stat(dest)).size !== size) {
    await fsp.unlink(dest);
    throw new Error("restore size mismatch — left the quarantined copy in place");
  }
  await fsp.unlink(src);
  return { rel, restoredTo: choice.tier || "hot", bytes: size };
}

module.exports = {
  TRASH_SUBDIR,
  RETENTION_DAYS,
  trashRoot,
  isTrashPath,
  assertInsideMediaRoot,
  quarantine,
  batchName,
  batchAgeDays,
  purgeExpired,
  trashSummary,
  restore,
};
