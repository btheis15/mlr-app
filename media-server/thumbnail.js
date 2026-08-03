// Fast-loading grid/album thumbnails for the MLR media server (Mac mini).
//
// WHY: every grid (Feed, work items, Drop Box albums) used to render the exact
// stored file — full-res photos, post-transcode videos — so scrolling an album
// re-downloaded full-size assets for every tile. This generates a small JPEG
// preview ALONGSIDE the original at upload time (photos: sharp resize; videos:
// first frame via ffmpeg), served from the same /f tree as a plain sibling file
// — no new route needed. Runs inline during /upload (a single small decode, not
// the moderation/transcode cost) so the response can return a thumbnail URL the
// client stores right away. Never fatal: a failure just means no thumbnail, and
// callers fall back to the full-res url.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const sharp = require("sharp");

const THUMB_DIM = Number(process.env.THUMB_DIM || 400);
const THUMB_QUALITY = Number(process.env.THUMB_QUALITY || 70);

function thumbPathFor(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  return path.join(dir, `${base}_thumb.jpg`);
}

async function makeImageThumb(filePath) {
  const out = thumbPathFor(filePath);
  await sharp(filePath, { failOn: "none" })
    .rotate()
    .resize({ width: THUMB_DIM, height: THUMB_DIM, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toFile(out);
  return out;
}

// One ffmpeg pass: grab the first frame and scale it down in the same filter,
// so there's no second decode/encode through sharp for video thumbnails.
function extractFirstFrameThumb(videoPath, outJpg) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y", "-i", videoPath,
      "-frames:v", "1",
      "-vf", `scale='min(${THUMB_DIM},iw)':-2`,
      "-q:v", "4",
      outJpg,
    ];
    execFile("ffmpeg", args, { timeout: 30000 }, (err) => (err ? reject(err) : resolve()));
  });
}

async function makeVideoThumb(filePath) {
  const out = thumbPathFor(filePath);
  await extractFirstFrameThumb(filePath, out);
  return out;
}

// kind: "image" | "video". Returns the thumbnail's absolute path, or null on
// any failure (caller falls back to the full-res url — never fatal, never
// blocks the upload).
async function makeThumbnail(filePath, kind) {
  try {
    return kind === "video" ? await makeVideoThumb(filePath) : await makeImageThumb(filePath);
  } catch (e) {
    console.warn(`[thumb] failed for ${filePath}: ${(e && e.message) || e}`);
    return null;
  }
}

module.exports = { makeThumbnail, thumbPathFor };
