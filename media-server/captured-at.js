// Best-effort "when was this actually taken" — so a Drop Box album can sort by
// real shot date/time instead of upload order.
//
// TWO sources, because the metadata survives to different places:
//
//   Videos  — never recompressed client-side, so the container's own
//             `creation_time` tag is intact when /upload runs. ffprobe (already
//             required by transcode.js) reads it.
//
//   Photos  — usually stripped BEFORE they get here: the app compresses photos
//             through a <canvas> re-encode (compressImage in lib/media.ts),
//             which drops every byte of EXIF. So the client reads EXIF off the
//             ORIGINAL file itself and sends the result as a form field, and
//             that's the primary path. BUT compressImage bails out and returns
//             the untouched original whenever re-encoding wouldn't actually
//             shrink the file — in that case the stored bytes DO still carry
//             EXIF. readImageCapturedAt() covers exactly that case, and is also
//             what lets the backfill recover dates for photos already on disk
//             (including ones referenced into an album from an old Feed post,
//             which the client can no longer re-read — the original File is
//             long gone, only the URL remains).
//
// The EXIF reader is a small hand-rolled TIFF/IFD walk rather than a dependency
// — it mirrors extractExifCapturedAt in lib/media.ts exactly (same tags, same
// preference order), so client and server can't disagree about a photo's date.
// Only the first 256KB is read; EXIF always sits near the front of a JPEG.
//
// Never fatal — a miss just means "no captured date," and the album falls back
// to sorting by upload time.

const fs = require("fs");
const { execFile } = require("child_process");

const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const TIMEOUT_MS = 15000;
const EXIF_SCAN_BYTES = 262144;

// ── Videos: the container's creation_time ────────────────────────────────────

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

// ── Photos: EXIF DateTimeOriginal (falling back to IFD0 DateTime) ────────────

// An ASCII (EXIF type 2) tag's value out of one IFD — a flat list of 12-byte
// entries after a uint16 count. A date tag is never any other type.
function findAsciiTag(view, tiffStart, ifdAbs, wantTag, le) {
  if (ifdAbs + 2 > view.byteLength) return null;
  const entryCount = view.getUint16(ifdAbs, le);
  for (let i = 0; i < entryCount; i++) {
    const entryAbs = ifdAbs + 2 + i * 12;
    if (entryAbs + 12 > view.byteLength) break;
    if (view.getUint16(entryAbs, le) !== wantTag) continue;
    const type = view.getUint16(entryAbs + 2, le);
    const count = view.getUint32(entryAbs + 4, le);
    const valueFieldOffset = entryAbs + 8;
    if (type !== 2) return null;
    // ≤4 bytes live inline in the value field; longer values are a pointer.
    const dataAbs = count <= 4 ? valueFieldOffset : tiffStart + view.getUint32(valueFieldOffset, le);
    if (dataAbs < 0 || dataAbs + count > view.byteLength) return null;
    let s = "";
    for (let j = 0; j < count; j++) {
      const c = view.getUint8(dataAbs + j);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s || null;
  }
  return null;
}

// A single LONG (type 4) value sits inline — used to follow ExifIFDPointer.
function findLongTag(view, ifdAbs, wantTag, le) {
  if (ifdAbs + 2 > view.byteLength) return null;
  const entryCount = view.getUint16(ifdAbs, le);
  for (let i = 0; i < entryCount; i++) {
    const entryAbs = ifdAbs + 2 + i * 12;
    if (entryAbs + 12 > view.byteLength) break;
    if (view.getUint16(entryAbs, le) === wantTag) return view.getUint32(entryAbs + 8, le);
  }
  return null;
}

// EXIF dates read "YYYY:MM:DD HH:MM:SS" with no timezone — treated as a plain
// local wall-clock moment, which is all that's needed for SORTING.
function parseExifDateString(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2}):(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const dt = new Date(y, mo - 1, d, h, mi, se);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Walk one TIFF block (the payload of an EXIF blob, starting at its "II"/"MM"
// byte-order mark) for a date. DateTimeOriginal in the Exif SubIFD wins; IFD0's
// plain DateTime is the fallback.
function parseTiffForDate(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return null;
  const bom = view.getUint16(tiffStart, false);
  if (bom !== 0x4949 && bom !== 0x4d4d) return null;
  const le = bom === 0x4949; // "II" little-endian, "MM" big-endian
  const ifd0Abs = tiffStart + view.getUint32(tiffStart + 4, le);
  const subIfdOffset = findLongTag(view, ifd0Abs, 0x8769, le); // ExifIFDPointer
  if (subIfdOffset != null) {
    const raw = findAsciiTag(view, tiffStart, tiffStart + subIfdOffset, 0x9003, le); // DateTimeOriginal
    const parsed = raw && parseExifDateString(raw);
    if (parsed) return parsed;
  }
  const rawDateTime = findAsciiTag(view, tiffStart, ifd0Abs, 0x0132, le); // DateTime
  return (rawDateTime && parseExifDateString(rawDateTime)) || null;
}

// A raw EXIF blob as handed over by an image library (sharp/libvips), which may
// or may not still carry the leading "Exif\0\0" marker.
function parseExifBlob(buf) {
  if (!buf || buf.length < 8) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const hasMarker =
    view.getUint32(0, false) === 0x45786966 && view.getUint16(4, false) === 0x0000;
  return parseTiffForDate(view, hasMarker ? 6 : 0);
}

// A whole JPEG file: walk its segment markers to the APP1/Exif one.
function parseExifFromBuffer(buf) {
  if (!buf || buf.length < 4) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint16(0, false) !== 0xffd8) return null; // not a JPEG
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    if ((marker & 0xff00) !== 0xff00) break; // desynced — bail
    if (marker === 0xffd8) { offset += 2; continue; }
    if (marker === 0xffda) break; // start of scan — no metadata past here
    const size = view.getUint16(offset + 2, false);
    if (size < 2) break;
    if (marker === 0xffe1) {
      const segStart = offset + 4;
      const isExif =
        segStart + 6 <= view.byteLength &&
        view.getUint32(segStart, false) === 0x45786966 && // "Exif"
        view.getUint16(segStart + 4, false) === 0x0000;
      if (isExif) {
        const parsed = parseTiffForDate(view, segStart + 6);
        if (parsed) return parsed;
      }
    }
    offset += 2 + size;
  }
  return null;
}

// sharp/libvips surfaces the EXIF blob for every format it can decode — HEIC
// (iPhone's default), WebP, AVIF, TIFF — not just JPEG, so this covers the
// formats the hand-rolled JPEG marker walk above can't even open. Kept as the
// SECOND attempt because the raw scan needs no decode at all and handles the
// overwhelmingly common case; this one costs a libvips open.
async function readExifViaSharp(filePath) {
  try {
    const sharp = require("sharp");
    const meta = await sharp(filePath, { failOn: "none" }).metadata();
    if (meta && meta.exif) return parseExifBlob(meta.exif);
  } catch {
    /* unsupported format, no libheif, corrupt file — all just "no date" */
  }
  return null;
}

// Read the capture date off an image already on disk. Returns ISO or null.
async function readImageCapturedAt(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(EXIF_SCAN_BYTES);
    const read = fs.readSync(fd, buf, 0, EXIF_SCAN_BYTES, 0);
    const fromJpeg = parseExifFromBuffer(buf.subarray(0, read));
    if (fromJpeg) return fromJpeg;
  } catch {
    /* fall through to sharp */
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
  return readExifViaSharp(filePath);
}

// kind: "image" | "video". Returns an ISO timestamp or null — never throws.
async function extractCapturedAt(filePath, kind) {
  try {
    return kind === "video" ? await videoCreationTime(filePath) : await readImageCapturedAt(filePath);
  } catch {
    return null;
  }
}

module.exports = {
  extractCapturedAt,
  readImageCapturedAt,
  parseExifFromBuffer,
  parseExifBlob,
};
