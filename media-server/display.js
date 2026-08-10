// Photo display renditions — the still-image counterpart to transcode.js.
//
// ⚠️ WHAT THIS REPLACES
//
// Photos used to be downscaled to 1920px and re-encoded at JPEG quality 0.82 in
// the BROWSER (`compressImage` in lib/media.ts) before upload. Three problems:
//   • the full-resolution original was destroyed and never reached the server, so
//     a 48MP iPhone photo became a 1920px q82 JPEG, permanently;
//   • the <canvas> round-trip strips EVERY byte of EXIF, which is the root cause
//     of the whole captured_at/"date taken" saga (migrations 0174-0176 exist
//     almost entirely to recover a date that was destroyed on the way up);
//   • HEIC had to be re-encoded client-side to be viewable at all.
//
// Now the browser uploads the untouched file and this builds the web copy here,
// where there's a real image library and no need to throw anything away:
//
//   <uuid>.jpg        display copy — what storage_path points at, what the
//                     lightbox loads. Browser-safe JPEG, generous but bounded.
//   <uuid>_orig.<ext> the untouched upload (HEIC, 48MP JPEG, whatever) — what
//                     ?dl=1 and album zips hand back.
//   <uuid>_thumb.jpg  the grid preview (thumbnail.js, unchanged)
//
// The `_orig` convention is shared with video, so the orphan sweep, usage walk,
// and zip logic already understand these files — see DERIVED_SUFFIXES in
// orphan-sweep.js.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { ORIGINAL_SUFFIX } = require("./transcode");

// Deliberately generous. The display copy only has to look perfect on a phone or
// laptop, and the original is kept for anything real — but bandwidth is no longer
// scarce (media serves directly now, not through a throttled relay), so there's
// no reason to be stingy. ~3200px at q90 lands around 1-2.5 MB.
const DISPLAY_MAX_EDGE = Number(process.env.PHOTO_DISPLAY_MAX_EDGE || 3200);
const DISPLAY_QUALITY = Number(process.env.PHOTO_DISPLAY_QUALITY || 90);
// Formats a browser can render directly. Anything else MUST get a JPEG copy or it
// simply won't display — HEIC is the common case, straight off an iPhone.
const BROWSER_SAFE = new Set(["jpeg", "jpg", "png", "webp", "gif", "avif"]);

/**
 * Does this image need a separate display copy, or is the upload already fine to
 * serve as-is? Mirrors transcode.js's isWebReady.
 */
function needsDisplayCopy(meta) {
  if (!meta || !meta.format) return true; // unknown → make a safe copy
  if (!BROWSER_SAFE.has(String(meta.format).toLowerCase())) return true; // HEIC etc
  const longEdge = Math.max(meta.width || 0, meta.height || 0);
  return longEdge > DISPLAY_MAX_EDGE;
}

/**
 * Build the display copy for a freshly-uploaded photo, preserving the original
 * beside it as `<uuid>_orig.<ext>`.
 *
 * Returns `{ path, changed, originalPath }` — `path` is what should be served.
 * Never throws: on any failure the upload is left exactly as it arrived and
 * serving continues from the original, because a photo that displays at full size
 * is strictly better than a failed upload.
 */
async function makeDisplayCopy(srcPath) {
  let meta;
  try {
    meta = await sharp(srcPath, { failOn: "none" }).metadata();
  } catch (e) {
    return { path: srcPath, changed: false, reason: `unreadable (${e && e.message})` };
  }

  if (!needsDisplayCopy(meta)) {
    // The upload IS the display file — no second copy, nothing renamed. (So a
    // normal web-sized JPEG behaves exactly as it always has.)
    return { path: srcPath, changed: false, reason: "already web-sized" };
  }

  const dir = path.dirname(srcPath);
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext);
  const out = path.join(dir, `${base}.jpg`);
  const origDest = path.join(dir, `${base}${ORIGINAL_SUFFIX}${ext}`);
  // Never read and write the same path in one sharp pipeline.
  const tmp = out === srcPath ? path.join(dir, `${base}.display.jpg`) : out;

  try {
    await sharp(srcPath, { failOn: "none" })
      // .rotate() with no argument applies the EXIF orientation and then clears
      // it. Without this, portrait phone photos render sideways.
      .rotate()
      .resize({
        width: DISPLAY_MAX_EDGE,
        height: DISPLAY_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true, // never upscale a small photo
      })
      // Keep EXIF on the display copy so "date taken" survives even if something
      // later only ever sees this file. mozjpeg for a smaller file at equal quality.
      .withMetadata()
      .jpeg({ quality: DISPLAY_QUALITY, mozjpeg: true })
      .toFile(tmp);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing written */
    }
    return { path: srcPath, changed: false, reason: `encode failed (${e && e.message})` };
  }

  try {
    if (out === srcPath) {
      // Same extension (.jpg in, .jpg out): move the ORIGINAL aside first, or the
      // rename below would clobber it. Both renames are same-directory and atomic.
      fs.renameSync(srcPath, origDest);
      fs.renameSync(tmp, out);
    } else {
      // Different extension (.heic in, .jpg out): the display copy is already at
      // its final name, so just move the original aside.
      fs.renameSync(srcPath, origDest);
    }
  } catch (e) {
    // Couldn't complete the swap — discard the copy and keep serving the upload
    // untouched rather than leaving a half-applied state.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    return { path: srcPath, changed: false, reason: `swap failed (${e && e.message})` };
  }

  return {
    path: out,
    changed: true,
    originalPath: origDest,
    from: `${meta.format} ${meta.width}x${meta.height}`,
  };
}

module.exports = { makeDisplayCopy, needsDisplayCopy, DISPLAY_MAX_EDGE, DISPLAY_QUALITY };
