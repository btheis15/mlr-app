// Shared media helpers for talking to the Mac-mini media server.
//
// These mirror the originals inside PostsView (kept there so the working Posts
// feature is left untouched). Committee chat uses these — and passes a
// `category`/`room` so its uploads are filed under chat/<committee>/ on the mini
// instead of the Posts folder. See media-server/server.js for the layout.

// All uploads go to the resort's mini (no size cap); the server returns a full
// URL, which the app stores verbatim. NEXT_PUBLIC_MEDIA_URL overrides it (local
// dev / if the tunnel URL ever changes).
/** The canonical media host. Media is served DIRECTLY from the mini via Caddy. */
const PRODUCTION_MEDIA_URL = "https://mlr-media.duckdns.org";

/**
 * The retired Tailscale Funnel host.
 *
 * ⚠️⚠️ `NEXT_PUBLIC_MEDIA_URL` IS STILL SET TO THIS IN VERCEL, and it is deliberately
 * IGNORED here rather than honored. Two reasons, both load-bearing:
 *
 * 1. It silently un-signed every photo in the app. Next.js inlines NEXT_PUBLIC_* at
 *    BUILD time, so the stale value was baked into the bundle and won over the code
 *    default — verified by grepping the live chunks (ts.net present, duckdns absent).
 *    mediaSrc() then compared duckdns URLs against a ts.net prefix, failed, and
 *    returned them unsigned with no error at all.
 * 2. It routes uploads and token fetches through the Funnel, which relays via
 *    Tailscale's DERP infrastructure and measured 12–21 Mbps against a 119 Mbps uplink
 *    — the exact throttle the move to Caddy + DuckDNS was made to escape. Media reads
 *    already go direct (the mini stamps PUBLIC_URL into stored rows); writes were
 *    quietly still taking the slow path.
 *
 * A genuine local-dev override still works — anything that isn't the retired host is
 * honored. Once the Vercel variable is removed or repointed, this guard becomes inert.
 */
const RETIRED_MEDIA_HOST = "brians-mac-mini.tail49943c.ts.net";

const configuredMediaUrl = (process.env.NEXT_PUBLIC_MEDIA_URL || "").trim();
export const MEDIA_URL = (
  configuredMediaUrl && !configuredMediaUrl.includes(RETIRED_MEDIA_HOST)
    ? configuredMediaUrl
    : PRODUCTION_MEDIA_URL
).replace(/\/+$/, "");

/**
 * Every host that has ever served this app's media.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE A STALE DEFAULT SILENTLY UN-SIGNED EVERY PHOTO IN THE APP.
 *
 * The fallback above used to be the old Tailscale Funnel hostname
 * (brians-mac-mini.tail49943c.ts.net). Media moved to mlr-media.duckdns.org and all
 * ~1,700 stored URLs were migrated, but NEXT_PUBLIC_MEDIA_URL was never set on Vercel —
 * so the deployed bundle kept comparing against the Tailscale host. `mediaSrc()` did
 * `if (!url.startsWith(MEDIA_URL)) return url`, a duckdns URL doesn't start with a
 * ts.net prefix, and so EVERY media URL was returned unsigned. Silently: no error, no
 * warning, and it looked identical to "we don't have a token yet".
 *
 * Confirmed by grepping the live bundle — 2 chunks contained the ts.net host, ZERO
 * contained duckdns — while the server logged 57 `tok=missing` requests from a real
 * iPhone that had successfully fetched a valid token seconds earlier.
 *
 * So matching is now by HOST against a known set, not by exact-prefix against one
 * configured string. A URL stored under any host this app has used still gets signed,
 * and a future host change degrades to "add an entry here" rather than to a silent
 * app-wide media outage.
 */
const LEGACY_MEDIA_HOSTS = [RETIRED_MEDIA_HOST];

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Hosts whose URLs are ours to sign. */
export const MEDIA_HOSTS: string[] = Array.from(
  new Set(
    [
      hostOf(MEDIA_URL),
      // ALWAYS accepted, whatever MEDIA_URL resolves to. Every stored row uses this
      // host; if a bad override could drop it from the list we would be right back to
      // silently unsigned photos.
      hostOf(PRODUCTION_MEDIA_URL),
      ...LEGACY_MEDIA_HOSTS,
    ].filter(Boolean)
  )
);

/**
 * Is this one of OUR media URLs (and therefore something to attach a token to)?
 *
 * Host-based on purpose — see MEDIA_HOSTS. Returns false for Supabase avatars,
 * `data:`/`blob:` previews and anything else, which must be left untouched.
 */
export function isMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const h = hostOf(url);
  return !!h && MEDIA_HOSTS.includes(h);
}

export interface UploadOptions {
  /** Folder bucket on the mini: "posts" (default), "chat", "work", or "dropbox". */
  category?: "posts" | "chat" | "work" | "dropbox";
  /** The sub-folder within the bucket: a chat room slug, or a drop-box id. */
  room?: string;
  onProgress?: (loaded: number, total: number) => void;
  /**
   * When the caller already knows the "date taken" (from `capturedAtForFile`,
   * read off the ORIGINAL file before it's compressed away), pass it here so
   * the mini can store it — for a video the server derives its own from the
   * container instead, so this is photo-only. ISO string, plus where it came
   * from so a weaker guess can be upgraded later.
   */
  capturedAt?: string | null;
  capturedAtSource?: CapturedAtSource | null;
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
export type CapturedAtSource = "exif" | "video" | "file" | "post";

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
    if (opts.capturedAtSource) fd.append("capturedAtSource", opts.capturedAtSource);
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
          if (!json.url) return reject(new UploadError("media server returned no URL", xhr.status));
          resolve({
            url: json.url,
            thumbnailUrl: json.thumbnailUrl ?? null,
            capturedAt: json.capturedAt ?? null,
            capturedAtSource: json.capturedAtSource ?? null,
            type: json.type ?? "file",
            path: json.path ?? "",
          });
        } catch {
          reject(new UploadError("media server returned a bad response", xhr.status));
        }
      } else {
        // The server answers errors as {"error":"…"} — parse it out rather than
        // showing the raw JSON to a family member.
        let msg = "";
        try {
          msg = String((JSON.parse(xhr.responseText) as { error?: string }).error || "");
        } catch {
          msg = (xhr.responseText || "").slice(0, 160);
        }
        reject(new UploadError(msg || `media upload failed (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new UploadError("Couldn't reach the media server.", 0));
    // A dropped connection mid-transfer is the single most common real-world
    // failure for a big video, and it fires here, NOT on onerror — without this
    // the promise would never settle and the tile would spin forever.
    xhr.onabort = () => reject(new UploadError("The upload was interrupted.", 0));
    xhr.ontimeout = () => reject(new UploadError("The upload timed out.", 0));
    xhr.send(fd);
  });
}

/** An upload failure that remembers the HTTP status, so callers can tell an
 *  out-of-space server from a too-big file from a dropped connection. */
export class UploadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

/**
 * One place that turns any upload failure into something a family member can act
 * on. Every composer shows this, so the wording can't drift between surfaces.
 *
 * Deliberately phrased as a fragment ("that file was too big") so a caller can
 * prefix it with the file's own name — knowing WHICH file failed is the whole
 * point when 20 photos went up and one didn't.
 */
export function uploadErrorMessage(err: unknown): string {
  const status = err instanceof UploadError ? err.status : 0;
  const m = err instanceof Error ? err.message : "";
  if (status === 507 || /out of storage/i.test(m)) return "the media server is out of space — tell an admin";
  if (status === 413 || /max|size|large|exceed|payload/i.test(m)) return "that file was too big";
  if (status === 429 || /too many/i.test(m)) return "hit the upload limit — try again shortly";
  if (status === 401 || status === 403 || /sign in|session/i.test(m)) return "your sign-in expired — try again";
  if (/interrupted|abort/i.test(m)) return "the upload was interrupted — check your connection";
  if (/timed out|timeout/i.test(m)) return "the upload timed out";
  if (/reach the media server/i.test(m)) return "couldn't reach the media server";
  return "upload failed";
}

/** "Beach.jpg — that file was too big" / "3 files couldn't upload". */
export function describeFailedUploads(failures: { name: string; reason: string }[]): string {
  if (!failures.length) return "";
  if (failures.length === 1) return `${failures[0].name} — ${failures[0].reason}`;
  const reasons = new Set(failures.map((f) => f.reason));
  const names = failures.slice(0, 2).map((f) => f.name).join(", ");
  const more = failures.length > 2 ? ` and ${failures.length - 2} more` : "";
  // One shared cause is worth naming once; a mix isn't worth listing per file.
  return reasons.size === 1 ? `${names}${more} — ${[...reasons][0]}` : `${names}${more} couldn't upload`;
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
 * the browser used to re-encode photos via <canvas>, stripping every byte of
 * metadata — this has to run on the ORIGINAL file. Prefers
 * DateTimeOriginal (Exif SubIFD, 0x9003) and falls back to the plain
 * DateTime tag (IFD0, 0x0132). Only reads the first ~256KB (EXIF always sits
 * near the front) so this is fast even on a big phone photo. Non-JPEG, no
 * EXIF, or anything unparseable → null, never throws — callers fall back to
 * upload time.
 */
/**
 * Walk a TIFF/EXIF header for a capture date: DateTimeOriginal (0x9003) in the
 * Exif sub-IFD, else IFD0's DateTime (0x0132). `tiffStart` is the offset of the
 * "II"/"MM" byte-order mark. Mirrors `parseTiffForDate` in
 * media-server/captured-at.js tag-for-tag, so client and server can never
 * disagree about which date a file claims.
 */
function parseTiffForDate(view: DataView, tiffStart: number): string | null {
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

/**
 * HEIC/HEIF (an ISO-BMFF container) — what an iPhone shoots BY DEFAULT, so this
 * is the single highest-value format to cover. There's no JPEG-style marker
 * chain to walk; the EXIF payload sits in an `Exif` item whose bytes still
 * contain an ordinary TIFF header. Rather than implement a full box/iinf/iloc
 * parser (a lot of surface area for one date), scan the head of the file for the
 * TIFF byte-order mark that follows an "Exif" tag and hand it to the shared
 * walker above — the same pragmatic trick the mini's byte scanner uses.
 */
function findHeicTiffStart(view: DataView): number | null {
  const limit = Math.min(view.byteLength - 8, 262144);
  for (let i = 0; i < limit; i++) {
    // "Exif" — the item name that precedes the TIFF header.
    if (
      view.getUint8(i) === 0x45 &&
      view.getUint8(i + 1) === 0x78 &&
      view.getUint8(i + 2) === 0x69 &&
      view.getUint8(i + 3) === 0x66
    ) {
      // The TIFF header starts within the next few bytes (there's usually a
      // 4-byte offset/pad between the tag and "II"/"MM"). Probe a small window.
      for (let j = i + 4; j <= i + 16 && j + 8 <= view.byteLength; j++) {
        const bom = view.getUint16(j, false);
        if (bom === 0x4949 || bom === 0x4d4d) return j;
      }
    }
  }
  return null;
}

export async function extractExifCapturedAt(file: File): Promise<string | null> {
  try {
    const isJpeg = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
    // iPhones shoot HEIC by default; the MINI now converts it to JPEG server-side
    // through a <canvas> (which destroys every byte of EXIF) BEFORE upload — so
    // if it isn't read here, the mini has nothing left to read either and the
    // photo's real date is lost for good. This was the main coverage hole.
    const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    if (!isJpeg && !isHeic) return null;

    const buf = await file.slice(0, 262144).arrayBuffer();
    const view = new DataView(buf);

    if (isHeic) {
      const tiffStart = findHeicTiffStart(view);
      return tiffStart == null ? null : parseTiffForDate(view, tiffStart);
    }

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

/**
 * Best-effort capture date for a file the user just picked, with its
 * provenance. Historically this had to run before the browser's own re-encode (which
 * re-encodes photos through a `<canvas>` and destroys EXIF).
 *
 * Two tiers, because EXIF isn't always reachable here:
 *  1. `exif` — the real thing, parsed from a JPEG's own metadata.
 *  2. `file` — the file's `lastModified`. For a photo picked out of a camera
 *     roll this is normally the shot's own date, and it's the only signal
 *     available for a **HEIC** (iPhone's default format), which the JPEG
 *     parser can't open at all. Guarded hard: a timestamp that's missing,
 *     implausible, or suspiciously close to *now* is rejected, since a
 *     picker that hands over a freshly-made temp copy stamps it with the
 *     current time — which would be upload time wearing a disguise.
 *
 * Returns `{ iso: null, source: null }` when nothing trustworthy is available;
 * the mini gets its own shot at the stored bytes afterward (and can read HEIC
 * via sharp when the original survives uncompressed), and a later sweep
 * upgrades a `file` guess to real EXIF if it finds any.
 */
export async function capturedAtForFile(
  file: File,
): Promise<{ iso: string | null; source: CapturedAtSource | null }> {
  const exif = await extractExifCapturedAt(file);
  if (exif) return { iso: exif, source: "exif" };

  const lm = file.lastModified;
  if (!lm || !Number.isFinite(lm)) return { iso: null, source: null };
  const now = Date.now();
  const EARLIEST = Date.UTC(1995, 0, 1); // older than any phone photo
  const FRESH_COPY_MS = 60_000; // ≈now ⇒ the picker stamped a temp copy
  if (lm < EARLIEST || lm > now + 60_000 || now - lm < FRESH_COPY_MS) {
    return { iso: null, source: null };
  }
  return { iso: new Date(lm).toISOString(), source: "file" };
}

/**
 * What to actually upload for a picked photo: the file exactly as the camera
 * produced it.
 *
 * ⚠️ THIS USED TO COMPRESS, AND THAT WAS THE BUG. It downscaled to 1920px and
 * re-encoded at JPEG quality 0.82 through a <canvas>, which:
 *   • destroyed the full-resolution original before it ever left the phone — a
 *     48MP photo became a 1920px q82 JPEG, permanently, with no way back;
 *   • stripped EVERY byte of EXIF, which is the root cause of the whole
 *     captured_at / "date taken" saga (migrations 0174-0176 exist almost entirely
 *     to recover a date this destroyed on the way up).
 *
 * The mini now builds the browser-facing display copy itself (media-server/
 * display.js) and keeps the upload as `<uuid>_orig.<ext>`, so there is nothing
 * left for the client to do but hand over the bytes. HEIC is fine — the server
 * converts it, which it can do properly with a real image library.
 *
 * Kept as a named function rather than deleting the call sites so there's one
 * obvious place to reintroduce client-side work if it's ever needed again (e.g. a
 * cap for pathologically large RAW files).
 *
 * ⚠️ Trade-off: uploads are now bigger — a few MB per photo instead of ~1MB — so
 * posting a large batch over cellular takes longer. Downloads are unaffected
 * (viewers get the display copy). Per-file failures are reported with a retry.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  return file;
}
