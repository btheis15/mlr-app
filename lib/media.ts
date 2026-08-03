// Shared media helpers for talking to the Mac-mini media server.
//
// These mirror the originals inside PostsView (kept there so the working Posts
// feature is left untouched). Committee chat uses these — and passes a
// `category`/`room` so its uploads are filed under chat/<committee>/ on the mini
// instead of the Posts folder. See media-server/server.js for the layout.

// All uploads go to the resort's mini (no size cap); the server returns a full
// URL, which the app stores verbatim. NEXT_PUBLIC_MEDIA_URL overrides it (local
// dev / if the tunnel URL ever changes).
export const MEDIA_URL = (
  process.env.NEXT_PUBLIC_MEDIA_URL || "https://brians-mac-mini.tail49943c.ts.net"
).replace(/\/+$/, "");

export interface UploadOptions {
  /** Folder bucket on the mini: "posts" (default), "chat", "work", or "dropbox". */
  category?: "posts" | "chat" | "work" | "dropbox";
  /** The sub-folder within the bucket: a chat room slug, or a drop-box id. */
  room?: string;
  onProgress?: (loaded: number, total: number) => void;
  /**
   * When the caller already knows the real "date taken" (from
   * `extractExifCapturedAt`, read off the ORIGINAL file before it's
   * compressed away), pass it here so the mini can store it — for a video the
   * server derives its own from the container instead, so this is
   * photo-only. ISO string.
   */
  capturedAt?: string | null;
}

/** A single photo/video attachment (shared across posts, work items, etc.). */
export type MediaKind = "image" | "video";
export interface Media {
  url: string;
  type: MediaKind;
  /** The mini path (for delete), when known. */
  path?: string;
  /** Small preview url (grids/albums render this instead of the full-res `url`). */
  thumbnailUrl?: string | null;
}

/**
 * Every PHOTO url in one group (a post's media, a comment's, a chat message's),
 * in display order — what the Lightbox swipes through when you tap any one of
 * them. Deliberately `=== "image"` rather than `!== "video"`: chat media also
 * carries "file"/"gif"/"sticker" kinds, and only real photos belong in a
 * full-screen photo carousel. Structurally typed so every surface's own Media
 * shape (lib's, PostsView's, chat's ChatMedia) can pass its list straight in.
 */
export function photoUrls(media: { url: string; type: string }[]): string[] {
  return media.filter((m) => m.type === "image").map((m) => m.url);
}

/** Where a `capturedAt` came from — real file metadata, or a weaker proxy.
 *  Stored alongside the date so the mini's sweep can later upgrade a proxy to
 *  real metadata without ever downgrading. */
export type CapturedAtSource = "exif" | "video" | "post";

/** What the mini's /upload actually returns. */
export interface UploadResult {
  url: string;
  thumbnailUrl: string | null;
  /** When the file was actually taken/recorded (EXIF for photos, container metadata for
   *  videos), ISO string — null when it couldn't be determined (falls back to upload time). */
  capturedAt: string | null;
  capturedAtSource: CapturedAtSource | null;
  type: MediaKind | "file";
  path: string;
}

// Ask the mini to AI-grade a caption/post's text for inappropriate language.
// Returns true if the post should be HELD for admin review. FAIL-OPEN: any
// error/unavailability returns false (the word-list gate + Flag-as-inappropriate
// are the backstops). Backed by the media-server's POST /moderate/text.
export async function moderatePostText(text: string, token: string): Promise<boolean> {
  const t = (text || "").trim();
  if (!t) return false;
  try {
    const res = await fetch(`${MEDIA_URL}/moderate/text`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: t }),
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { flagged?: boolean };
    return !!j.flagged;
  } catch {
    return false;
  }
}

// XMLHttpRequest (not fetch) so we get real upload progress for the bar.
// Returns the full { url, thumbnailUrl } pair — the mini now generates a small
// preview alongside the original at upload time (media-server/thumbnail.js),
// so callers building a *_media row insert should carry `thumbnailUrl` through
// alongside `url`/`storage_path` (grids/albums render it instead of the
// full-res file). `thumbnailUrl` is null when generation failed — always a
// safe fallback to the full-res url, never a reason to fail the upload.
export function uploadToMini(file: File, token: string, opts: UploadOptions = {}): Promise<UploadResult> {
  const params = new URLSearchParams();
  if (opts.category) params.set("category", opts.category);
  if (opts.room) params.set("room", opts.room);
  const qs = params.toString();
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    if (opts.capturedAt) fd.append("capturedAt", opts.capturedAt);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${MEDIA_URL}/upload${qs ? `?${qs}` : ""}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText) as Partial<UploadResult>;
          if (!json.url) return reject(new Error("media server returned no URL"));
          resolve({
            url: json.url,
            thumbnailUrl: json.thumbnailUrl ?? null,
            capturedAt: json.capturedAt ?? null,
            capturedAtSource: json.capturedAtSource ?? null,
            type: json.type ?? "file",
            path: json.path ?? "",
          });
        } catch {
          reject(new Error("media server returned a bad response"));
        }
      } else {
        reject(new Error((xhr.responseText || "").slice(0, 160) || `media upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Couldn't reach the media server."));
    xhr.send(fd);
  });
}

// Read a tag's raw value-field bytes out of one IFD (a flat list of 12-byte
// entries after a uint16 count) — used by extractExifCapturedAt below. Only
// handles ASCII (EXIF type 2), which is all a date string ever is.
function findAsciiTag(view: DataView, tiffStart: number, ifdAbs: number, wantTag: number, le: boolean): string | null {
  if (ifdAbs + 2 > view.byteLength) return null;
  const entryCount = view.getUint16(ifdAbs, le);
  for (let i = 0; i < entryCount; i++) {
    const entryAbs = ifdAbs + 2 + i * 12;
    if (entryAbs + 12 > view.byteLength) break;
    const tag = view.getUint16(entryAbs, le);
    if (tag !== wantTag) continue;
    const type = view.getUint16(entryAbs + 2, le);
    const count = view.getUint32(entryAbs + 4, le);
    const valueFieldOffset = entryAbs + 8;
    if (type !== 2) return null; // ASCII only — a date is never anything else
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

// A LONG (type 4, single value) tag's value sits inline in the entry's value
// field — used to follow the ExifIFDPointer (0x8769) to the Exif SubIFD.
function findLongTag(view: DataView, ifdAbs: number, wantTag: number, le: boolean): number | null {
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
// local wall-clock moment (good enough for SORTING purposes, which is all
// this is for).
function parseExifDateString(s: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number);
  const dt = new Date(y, mo - 1, d, h, mi, se);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Read the shot's real date/time straight out of a JPEG's EXIF, BEFORE
 * `compressImage` re-encodes it via <canvas> and strips every byte of
 * metadata — this has to run on the ORIGINAL file. Prefers
 * DateTimeOriginal (Exif SubIFD, 0x9003) and falls back to the plain
 * DateTime tag (IFD0, 0x0132). Only reads the first ~256KB (EXIF always sits
 * near the front) so this is fast even on a big phone photo. Non-JPEG, no
 * EXIF, or anything unparseable → null, never throws — callers fall back to
 * upload time.
 */
export async function extractExifCapturedAt(file: File): Promise<string | null> {
  try {
    if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
    const buf = await file.slice(0, 262144).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset, false);
      if ((marker & 0xff00) !== 0xff00) break; // not a marker — bail
      if (marker === 0xffd8) { offset += 2; continue; }
      if (marker === 0xffda) break; // start of scan — no metadata follows

      const size = view.getUint16(offset + 2, false);
      if (size < 2) break;

      if (marker === 0xffe1) {
        const segStart = offset + 4;
        const isExif =
          segStart + 6 <= view.byteLength &&
          view.getUint32(segStart, false) === 0x45786966 && // "Exif"
          view.getUint16(segStart + 4, false) === 0x0000;
        if (isExif) {
          const tiffStart = segStart + 6;
          const bom = view.getUint16(tiffStart, false);
          const le = bom === 0x4949; // "II" little-endian; "MM" is big-endian
          if (bom === 0x4949 || bom === 0x4d4d) {
            const ifd0Offset = view.getUint32(tiffStart + 4, le);
            const ifd0Abs = tiffStart + ifd0Offset;

            const subIfdOffset = findLongTag(view, ifd0Abs, 0x8769, le); // ExifIFDPointer
            if (subIfdOffset != null) {
              const raw = findAsciiTag(view, tiffStart, tiffStart + subIfdOffset, 0x9003, le); // DateTimeOriginal
              const parsed = raw && parseExifDateString(raw);
              if (parsed) return parsed;
            }
            const rawDateTime = findAsciiTag(view, tiffStart, ifd0Abs, 0x0132, le); // DateTime
            const parsed = rawDateTime && parseExifDateString(rawDateTime);
            if (parsed) return parsed;
          }
        }
      }
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

// Downscale + re-encode photos to web JPEGs before upload (smaller + faster,
// and fixes HDR/HEIC display). Videos and anything non-image pass through.
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    bitmap.close();
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // never block sending on a compression hiccup
  }
}
