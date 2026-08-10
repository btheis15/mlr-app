#!/usr/bin/env node
// One-off: build a capped playback rendition for videos that predate the
// preserve-originals change, so the existing album stops buffering.
//
// WHY THIS EXISTS
//
// Until now the transcoder judged a file "web-ready" on codec + container +
// resolution and never looked at BITRATE, so phone recordings sailed through
// untouched at 18–36 Mbps. Playing 36 Mbps needs 4.6 MB/s sustained to the
// viewer; the public tunnel delivers ~12–21 Mbps, so those clips could not be
// watched in real time at all. Every new upload is handled by transcode.js now —
// this covers what's already on disk.
//
// ⚠️ WHAT IT DOES AND DOESN'T PRESERVE
//
// The true camera originals for these files are already gone: the old code
// re-encoded in place and deleted them. So the best available source is the file
// currently on disk. This renames THAT to `<uuid>_orig.<ext>` (nothing is
// destroyed, and it becomes what ?dl=1 serves) and writes the capped rendition at
// the url everything already points at. No database rows change.
//
// Idempotent: a video that already has an `_orig` sibling is skipped, so re-runs
// are free and an interrupted run can just be started again.
//
//   node scripts/recap-video-bitrate.js --dry-run
//   node scripts/recap-video-bitrate.js

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const tiers = require("../media-tiers");
const trash = require("../media-trash");
const { maybeTranscode, inspectVideo, findOriginal, TARGET_MAX_BPS, ffmpegAvailable } = require("../transcode");

const DRY = process.argv.includes("--dry-run");
const VIDEO_RE = /\.(mov|mp4|m4v|avi|mkv|webm|3gp|3g2|hevc|ts|mts|m2ts|wmv|flv)$/i;
const mb = (b) => (b / 1048576).toFixed(1);

function listVideos(root) {
  const out = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (trash.isTrashPath(r)) continue; // never touch quarantined media
      if (e.isDirectory()) { stack.push(r); continue; }
      if (!e.isFile() || !VIDEO_RE.test(e.name)) continue;
      const noExt = e.name.slice(0, e.name.length - path.extname(e.name).length);
      if (noExt.endsWith("_orig")) continue; // that IS an original
      out.push(path.join(root, r));
    }
  }
  return out;
}

(async () => {
  if (!(await ffmpegAvailable())) {
    console.error("ffmpeg/ffprobe not found — install with: brew install ffmpeg");
    process.exit(1);
  }
  const cap = TARGET_MAX_BPS / 1e6;
  console.log(`\ncap: ${cap} Mbps${DRY ? "   (DRY RUN — nothing will be written)" : ""}\n`);

  const seen = new Set();
  const files = [];
  for (const root of tiers.mediaRoots()) {
    for (const f of listVideos(root)) {
      const rel = tiers.relFromAbs(f);
      if (rel && seen.has(rel)) continue; // same file mirrored on both volumes
      if (rel) seen.add(rel);
      files.push(f);
    }
  }

  let done = 0, skipped = 0, failed = 0, beforeBytes = 0, afterBytes = 0;
  for (const f of files) {
    const name = path.basename(f);
    if (findOriginal(f)) { skipped++; continue; } // already has a preserved original
    let info;
    try {
      info = await inspectVideo(f);
    } catch (e) {
      console.log(`  ?  ${name}  (unreadable: ${e.message})`);
      failed++;
      continue;
    }
    if (!info.bitrate || info.bitrate <= TARGET_MAX_BPS * 1.15) {
      console.log(`  ·  ${name}  ${(info.bitrate / 1e6).toFixed(1)} Mbps — already fine`);
      skipped++;
      continue;
    }
    const sizeBefore = fs.statSync(f).size;
    process.stdout.write(`  →  ${name}  ${(info.bitrate / 1e6).toFixed(1)} Mbps, ${mb(sizeBefore)} MB … `);
    if (DRY) { console.log("would re-encode"); done++; beforeBytes += sizeBefore; continue; }
    try {
      const r = await maybeTranscode(f, "video/mp4", { keepOriginalUrl: false });
      if (!r.transcoded) { console.log(`skipped (${r.reason})`); skipped++; continue; }
      const after = await inspectVideo(r.path);
      const sizeAfter = fs.statSync(r.path).size;
      beforeBytes += sizeBefore;
      afterBytes += sizeAfter;
      console.log(`${(after.bitrate / 1e6).toFixed(1)} Mbps, ${mb(sizeAfter)} MB  (original kept as ${path.basename(r.originalPath || "")})`);
      done++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${done} re-encoded, ${skipped} skipped, ${failed} failed`);
  if (afterBytes) console.log(`playback bytes: ${mb(beforeBytes)} MB -> ${mb(afterBytes)} MB`);
  if (!DRY && done) console.log(`originals preserved alongside; ?dl=1 now serves them`);
})().catch((e) => { console.error(e); process.exit(1); });
