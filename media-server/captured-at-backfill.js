// Recover "date taken" for Drop Box items that were added before the metadata
// was being captured — or that came in through a path where the client couldn't
// read it.
//
// WHY THIS EXISTS: the client reads a photo's EXIF off the ORIGINAL File right
// before compressImage re-encodes it away. That covers a fresh upload, but not:
//   • anything added before this feature shipped, and
//   • a photo referenced into an album from an existing Feed post — there is no
//     File left on the client, only a URL, so it has nothing to read.
// In both cases the bytes are still sitting on this machine, and whenever
// compressImage decided re-encoding wasn't worth it (the "already small enough"
// bail-out) those bytes still carry full EXIF. This sweep reads them.
//
// Fills `drop_box_media.captured_at` where it's NULL, and UPGRADES rows whose
// date was only ever a proxy (`captured_at_source = 'post'` — the source post's
// own timestamp) when real EXIF turns up, since real metadata always wins.
//
// Self-contained + never throws: a missing file, an unreadable header, or a
// Supabase hiccup can't take down the server.

const fs = require("fs");
const path = require("path");

const { extractCapturedAt } = require("./captured-at");
const { localPathFor } = require("./media-paths");
const tiers = require("./media-tiers");

const SWEEP_MS = Number(process.env.CAPTURED_AT_SWEEP_MS || 6 * 60 * 60 * 1000); // 6h
const FIRST_SWEEP_MS = Number(process.env.CAPTURED_AT_FIRST_MS || 45 * 1000); // 45s after boot
const PER_SWEEP = Number(process.env.CAPTURED_AT_PER_SWEEP || 500);

async function sweepOnce({ admin, mediaDir }) {
  if (!admin) return;
  // Rows still missing a real capture date: never resolved, or resolved only
  // from the weaker post-timestamp proxy.
  const { data, error } = await admin
    .from("drop_box_media")
    .select("id, storage_path, media_type, captured_at, captured_at_source")
    .or("captured_at.is.null,captured_at_source.in.(post,file)")
    .limit(PER_SWEEP);

  if (error) {
    // Pre-migration (no captured_at_source column yet) or any read error —
    // log once and try again next sweep rather than crashing the job.
    console.warn(`[captured-at] read error (skipping sweep): ${error.message}`);
    return;
  }
  if (!data || !data.length) return;

  let filled = 0;
  let upgraded = 0;
  let missing = 0;

  for (const row of data) {
    // Resolved across both volumes (see thumbnail-backfill for the reasoning).
    const abs = localPathFor(row.storage_path, tiers.mediaRoots());
    if (!abs || !fs.existsSync(abs)) { missing++; continue; }
    const kind = row.media_type === "video" ? "video" : "image";
    let iso = null;
    try {
      iso = await extractCapturedAt(abs, kind);
    } catch (e) {
      console.warn(`[captured-at] ${path.basename(abs)}: ${e && e.message}`);
    }
    if (!iso) continue; // genuinely no metadata left — leave it to fall back
    // Only ever move UP: fill an empty date, or replace one of the weaker
    // guesses ('post' proxy, 'file' mtime) with the real thing. Never overwrite
    // metadata already read off the file itself.
    const isProxy = row.captured_at_source === "post" || row.captured_at_source === "file";
    if (row.captured_at && !isProxy) continue;

    const { error: upErr } = await admin
      .from("drop_box_media")
      .update({ captured_at: iso, captured_at_source: kind === "video" ? "video" : "exif" })
      .eq("id", row.id);
    if (upErr) { console.warn(`[captured-at] update failed: ${upErr.message}`); continue; }
    if (row.captured_at) upgraded++; else filled++;
  }

  if (filled || upgraded || missing) {
    console.log(
      `[captured-at] sweep: ${filled} filled, ${upgraded} upgraded from real metadata, ${missing} file(s) not on disk`,
    );
  }
}

function startCapturedAtBackfill(deps) {
  if (!deps || !deps.admin || !deps.mediaDir) {
    console.warn("[captured-at] backfill not started (missing deps)");
    return;
  }
  console.log(`[captured-at] backfill armed — sweep every ${Math.round(SWEEP_MS / 3600000)}h`);
  const run = () => {
    sweepOnce(deps).catch((e) => console.warn(`[captured-at] sweep error: ${e && e.message}`));
  };
  setTimeout(run, FIRST_SWEEP_MS);
  setInterval(run, SWEEP_MS);
}

module.exports = { startCapturedAtBackfill, sweepOnce, localPathFor };
