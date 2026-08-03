// Generate the small grid/album previews for media that was uploaded before
// thumbnails existed (or whose generation failed at the time).
//
// WHY: makeThumbnail runs inline during /upload, so it only ever covers NEW
// uploads. Everything already on disk — every Feed photo, every album item —
// has thumbnail_url = null, and grids fall back to downloading the full-res
// file for every tile. For videos it's worse than slow: with no poster frame a
// tile renders as a bare <video preload="metadata">, which on iOS paints a
// black box, so an album of clips looks broken.
//
// The bytes are all still here, so this sweeps the *_media tables, generates
// the missing thumbnails from the local files, and fills in the column.
// Idempotent (only touches null thumbnail_url), resumable, and never fatal —
// a missing file or a bad decode just gets skipped.

const fs = require("fs");
const path = require("path");

const { makeThumbnail, thumbPathFor } = require("./thumbnail");
const { localPathFor } = require("./media-paths");

const SWEEP_MS = Number(process.env.THUMB_BACKFILL_MS || 6 * 60 * 60 * 1000); // 6h
const FIRST_SWEEP_MS = Number(process.env.THUMB_BACKFILL_FIRST_MS || 75 * 1000); // 75s after boot
const PER_SWEEP = Number(process.env.THUMB_BACKFILL_PER_SWEEP || 200);

// Only the tables whose UI actually renders a thumbnail today. Chat bubbles
// carry the column but don't read it yet, so generating for them would be
// wasted work — add them here when CommitteeChat/HouseChat start using it.
const TABLES = ["drop_box_media", "post_media", "post_comment_media", "work_item_media"];

async function sweepTable(admin, table, { publicUrl, mediaDir }) {
  const { data, error } = await admin
    .from(table)
    .select("id, storage_path, media_type")
    .is("thumbnail_url", null)
    .limit(PER_SWEEP);

  if (error) {
    // Pre-0173 (no thumbnail_url column) or a transient read error — skip this
    // table for now rather than taking the whole sweep down.
    console.warn(`[thumb-backfill] ${table}: ${error.message}`);
    return { made: 0, skipped: 0 };
  }
  if (!data || !data.length) return { made: 0, skipped: 0 };

  let made = 0;
  let skipped = 0;

  for (const row of data) {
    const abs = localPathFor(row.storage_path, mediaDir);
    if (!abs || !fs.existsSync(abs)) { skipped++; continue; }
    const kind = row.media_type === "video" ? "video" : "image";

    // A previous sweep may have written the file but failed to record the URL
    // (crash between the two) — reuse it instead of re-encoding.
    let thumbPath = thumbPathFor(abs);
    if (!fs.existsSync(thumbPath) || fs.statSync(thumbPath).size === 0) {
      thumbPath = await makeThumbnail(abs, kind); // null on failure, never throws
    }
    if (!thumbPath) { skipped++; continue; }

    const rel = path.relative(mediaDir, thumbPath).split(path.sep).join("/");
    const { error: upErr } = await admin
      .from(table)
      .update({ thumbnail_url: `${publicUrl}/f/${rel}` })
      .eq("id", row.id);
    if (upErr) { console.warn(`[thumb-backfill] ${table} update: ${upErr.message}`); skipped++; continue; }
    made++;
  }

  return { made, skipped };
}

async function sweepOnce({ admin, publicUrl, mediaDir }) {
  if (!admin) return;
  let made = 0;
  let skipped = 0;
  for (const table of TABLES) {
    const r = await sweepTable(admin, table, { publicUrl, mediaDir });
    made += r.made;
    skipped += r.skipped;
  }
  if (made || skipped) {
    console.log(`[thumb-backfill] sweep: ${made} thumbnail(s) generated, ${skipped} skipped`);
  }
}

function startThumbnailBackfill(deps) {
  if (!deps || !deps.admin || !deps.mediaDir || !deps.publicUrl) {
    console.warn("[thumb-backfill] not started (missing deps)");
    return;
  }
  console.log(`[thumb-backfill] armed — sweep every ${Math.round(SWEEP_MS / 3600000)}h`);
  const run = () => {
    sweepOnce(deps).catch((e) => console.warn(`[thumb-backfill] sweep error: ${e && e.message}`));
  };
  setTimeout(run, FIRST_SWEEP_MS);
  setInterval(run, SWEEP_MS);
}

module.exports = { startThumbnailBackfill, sweepOnce };
