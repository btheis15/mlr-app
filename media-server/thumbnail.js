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

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
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

// How far into a clip to grab the poster frame. Frame 0 is a bad default for
// real phone video: it's routinely black or a blurred half-exposure while the
// camera is still settling, so a whole album of videos comes out as black
// tiles. Seeking a moment in gets an actual picture of the scene.
const SEEK_FRACTION = Number(process.env.THUMB_SEEK_FRACTION || 0.1); // 10% in
const SEEK_MAX_S = Number(process.env.THUMB_SEEK_MAX_S || 3); // never past 3s

function probeDurationSeconds(videoPath) {
  return new Promise((resolve) => {
    execFile(
      FFPROBE,
      ["-v", "quiet", "-print_format", "json", "-show_entries", "format=duration", videoPath],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const d = Number(JSON.parse(stdout)?.format?.duration);
          resolve(Number.isFinite(d) && d > 0 ? d : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// One ffmpeg pass: seek, grab a frame, and scale it down in the same filter, so
// there's no second decode/encode through sharp. `-ss` BEFORE `-i` is the fast
// (keyframe) seek — cheap even on a long clip.
function grabFrame(videoPath, outJpg, atSeconds) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      ...(atSeconds > 0 ? ["-ss", String(atSeconds)] : []),
      "-i", videoPath,
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
  const duration = await probeDurationSeconds(filePath);
  // Stay comfortably inside the clip — seeking at/past the end yields no frame
  // at all, and a very short clip has nowhere to seek to.
  let at = 0;
  if (duration) at = Math.min(duration * SEEK_FRACTION, SEEK_MAX_S, Math.max(0, duration - 0.1));
  try {
    await grabFrame(filePath, out, at);
    // A seek that lands past the last keyframe can produce nothing without
    // erroring — treat an absent/empty file as a miss and retry from the start.
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  } catch {
    /* fall through to the frame-0 retry */
  }
  if (at > 0) {
    await grabFrame(filePath, out, 0);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  }
  throw new Error("no frame could be extracted");
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
