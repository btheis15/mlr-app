// Best-effort "when was this actually taken" for Drop Box albums — so an
// album can sort by real shot date/time instead of just upload order.
//
// Photos: NOT handled here. The app compresses every photo to a plain JPEG
// via a <canvas> re-encode BEFORE it ever reaches this server (compressImage
// in lib/media.ts), which strips all EXIF — so by the time a photo lands in
// /upload there's nothing left to read. The client extracts EXIF
// DateTimeOriginal itself, from the ORIGINAL file, before compressing it (see
// lib/media.ts's extractExifCapturedAt), and sends the result along as a
// plain field.
//
// Videos: NOT recompressed client-side (only transcoded here, in the
// background, after this responds), so the original container's
// `creation_time` tag is still intact when /upload runs. ffprobe (already
// required for transcode.js) reads it. Never fatal — a miss just means "no
// captured date," and the album falls back to sorting by upload time.

const { execFile } = require("child_process");

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const TIMEOUT_MS = 15000;

function videoCreationTime(filePath) {
  return new Promise((resolve) => {
    execFile(
      FFPROBE,
      ["-v", "quiet", "-print_format", "json", "-show_entries", "format_tags=creation_time", filePath],
      { timeout: TIMEOUT_MS },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const json = JSON.parse(stdout);
          const raw = json && json.format && json.format.tags && json.format.tags.creation_time;
          if (!raw) return resolve(null);
          const d = new Date(raw);
          resolve(Number.isNaN(d.getTime()) ? null : d.toISOString());
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// kind: "image" | "video". Returns an ISO timestamp or null — never throws.
async function extractCapturedAt(filePath, kind) {
  if (kind !== "video") return null;
  try {
    return await videoCreationTime(filePath);
  } catch {
    return null;
  }
}

module.exports = { extractCapturedAt };
