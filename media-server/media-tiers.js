// Two storage volumes, one URL space.
//
// The app stores every media reference as an absolute ".../f/<rel>" URL — it
// never records WHICH disk the bytes are on. That's what makes a second volume
// cheap: a file can live on either one (or both) and the URL is unchanged, so
// moving or mirroring bytes needs no database write at all.
//
//   HOT  (MEDIA_DIR)       — the mac mini's internal SSD. Primary. All uploads
//                            land here, all reads are served from here first.
//   COLD (MEDIA_COLD_DIR)  — the external drive. A full backup mirror of hot,
//                            and the only home for anything too big to fit the
//                            hot allowance.
//
// Reads try hot, then cold (see the static chain in server.js). So dropping a
// file from the SSD once it's mirrored is just an unlink — the next request
// falls through to the cold copy transparently. That property is why eviction,
// when it eventually ships, never has to copy a file across volumes.
//
// COLD IS OPTIONAL AND MAY VANISH AT ANY MOMENT (drive unplugged, spun down,
// unmounted). Nothing here throws when it's gone; callers get a shorter root
// list and `coldReady()` false. Only the mirror job cares enough to wait.
//
// No dependencies on purpose: this stays require-able from anywhere.

const fs = require("fs");
const path = require("path");

const HOT_DIR = process.env.MEDIA_DIR || path.join(__dirname, "media");
const COLD_DIR = (process.env.MEDIA_COLD_DIR || "").trim() || null;

// Flat "/f/<uuid>.<ext>" URLs saved before uploads were filed by feature+month
// still have to resolve. Each volume carries its own legacy folder.
const LEGACY_SUBPATH = path.join("posts", "legacy");

/**
 * Is `dir` on a REAL mounted volume?
 *
 * Compares filesystem device ids rather than testing for existence, because the
 * dangerous case looks identical to the healthy one: when a drive is unplugged,
 * /Volumes/<name>/… is often still a walkable (empty) directory on the BOOT
 * disk. Writing there silently misfiles media onto the internal SSD while every
 * existing photo 404s. A real mount sits on a different device than "/"; a
 * leftover stub sits on the same one.
 *
 * A non-/Volumes path (the internal SSD, or ./media in dev) is always "mounted".
 */
function volumeMounted(dir) {
  if (!dir) return false;
  if (!dir.startsWith("/Volumes/")) {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  }
  const volRoot = "/" + dir.split("/").slice(1, 3).join("/"); // /Volumes/<name>
  try {
    return fs.statSync(volRoot).dev !== fs.statSync("/").dev;
  } catch {
    return false; // the mountpoint doesn't even exist
  }
}

// The cold volume's availability is re-checked at runtime, not decided once at
// boot — the drive can be unplugged and replugged while we're running. Cached
// briefly so a burst of requests doesn't turn into a burst of statSync calls on
// a disk that may be spinning up.
let coldCheckedAt = 0;
let coldOk = false;
const COLD_CHECK_TTL_MS = 5000;

function coldReady() {
  if (!COLD_DIR) return false;
  const now = Date.now();
  if (now - coldCheckedAt < COLD_CHECK_TTL_MS) return coldOk;
  coldOk = volumeMounted(COLD_DIR);
  coldCheckedAt = now;
  return coldOk;
}

/** Force the next coldReady() to re-stat (call after a mount/unmount event). */
function invalidateColdCheck() {
  coldCheckedAt = 0;
}

/**
 * Every media root that currently exists, in READ PRIORITY order: hot first,
 * then cold. Includes each volume's legacy subfolder so flat URLs resolve.
 */
function readRoots() {
  const roots = [HOT_DIR, path.join(HOT_DIR, LEGACY_SUBPATH)];
  if (coldReady()) roots.push(COLD_DIR, path.join(COLD_DIR, LEGACY_SUBPATH));
  return roots;
}

/** Just the volume roots (no legacy subfolders), hot first. */
function mediaRoots() {
  return coldReady() ? [HOT_DIR, COLD_DIR] : [HOT_DIR];
}

/**
 * Resolve a media-root-relative path to the volume that actually has the file.
 * Hot wins when both do. Returns null only if `rel` is unsafe.
 *
 * When the file exists nowhere, this returns the HOT path — so a caller that
 * goes on to read it gets the same ENOENT it would have gotten before there
 * were two volumes, instead of a confusing null.
 */
function resolveRel(rel) {
  if (typeof rel !== "string" || !rel) return null;
  if (rel.includes("..") || rel.includes("\0")) return null;
  for (const root of mediaRoots()) {
    const abs = path.resolve(path.join(root, rel));
    // Re-verify after resolution: a textual check alone can be defeated by
    // encoded or symlink-ish input.
    if (!abs.startsWith(path.resolve(root) + path.sep)) continue;
    try {
      if (fs.existsSync(abs)) return abs;
    } catch {
      /* unreadable volume — fall through to the next root */
    }
  }
  const hot = path.resolve(path.join(HOT_DIR, rel));
  return hot.startsWith(path.resolve(HOT_DIR) + path.sep) ? hot : null;
}

/** The path a given rel WOULD have on each tier (no existence check). */
function hotPathFor(rel) {
  return path.join(HOT_DIR, rel);
}
function coldPathFor(rel) {
  return COLD_DIR ? path.join(COLD_DIR, rel) : null;
}

/**
 * Turn an absolute path back into its media-root-relative form (forward
 * slashes, suitable for a "/f/<rel>" URL), whichever volume it's on.
 * Returns null if the path isn't under any media root.
 */
function relFromAbs(abs) {
  if (!abs) return null;
  const resolved = path.resolve(abs);
  // Longest root first, so HOT/posts/legacy wins over HOT for a legacy file.
  const roots = [...readRoots()].sort((a, b) => b.length - a.length);
  for (const root of roots) {
    const rel = path.relative(path.resolve(root), resolved);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.split(path.sep).join("/");
    }
  }
  return null;
}

/** Which tier an absolute path belongs to: "hot" | "cold" | null. */
function tierOf(abs) {
  if (!abs) return null;
  const resolved = path.resolve(abs);
  if (resolved.startsWith(path.resolve(HOT_DIR) + path.sep)) return "hot";
  if (COLD_DIR && resolved.startsWith(path.resolve(COLD_DIR) + path.sep)) return "cold";
  return null;
}

// ── Write-time routing ─────────────────────────────────────────────────────
//
// Which volume should a NEW upload land on? The rule is deliberately one line of
// policy: put it on the SSD if it fits the allowance, otherwise the external
// drive. Nothing routes on file type, and nothing moves after the fact — there
// is only ever a reason to use the external drive when the SSD is filling up.
//
// This became REQUIRED (rather than a later refinement) the moment the per-file
// cap went to 50 GB: a single upload can now exceed the SSD's free space, so
// without this check one big video could fill the boot disk and take the whole
// machine down, not just the media server.
//
// The size input is Content-Length, because multer has to choose a destination
// BEFORE the bytes arrive and `file.size` doesn't exist yet. /upload is
// `upload.single("file")` — one file per request, so Content-Length is that
// file's size plus a few hundred bytes of multipart framing. (A batch of photos
// is N separate requests, each routed on its own size, so a big album of small
// photos still lands on the SSD.) Deciding up front is the whole point: the
// alternative — write somewhere, then move — makes every misroute a full
// re-copy of the largest files in the system.

// The largest single file allowed on the SSD. Anything bigger goes straight to
// the external drive no matter how much room is free — the SSD exists to make
// the MANY SMALL, RECENTLY-VIEWED files fast, and one 50 GB video would consume
// a fifth of the allowance while being watched approximately once. Videos stream
// sequentially, which is the access pattern a spinning disk is actually good at.
//
// Note this is a ROUTING preference, not a hard limit: with no external drive
// configured, an oversized file still lands on the SSD (the free-space reserve
// below is the only true floor) rather than being refused.
const HOT_MAX_FILE_BYTES = Number(process.env.MEDIA_HOT_MAX_FILE_MB || 250) * 1024 ** 2;

// How much of the SSD the media library may occupy. Protects the mini FROM the
// app — this machine is storage-tight, and without a cap media would grow until
// it hit the reserve floor below and leave nothing for Xcode/simulators/caches.
const HOT_ALLOWANCE_BYTES = Number(process.env.MEDIA_HOT_ALLOWANCE_GB || 25) * 1024 ** 3;
// Free space that must remain on the SSD no matter what. Protects the boot disk
// FROM everything, and overrides the allowance.
const HOT_RESERVE_BYTES = Number(process.env.MEDIA_HOT_RESERVE_GB || 15) * 1024 ** 3;

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize; // bavail = free to a non-root user
  } catch {
    return null;
  }
}

/**
 * Where should an incoming upload of `incomingBytes` go?
 *
 * @param hotUsedBytes what the library currently occupies on the SSD, if known
 *        (the cached usage walk — pass null and only the free-space floor applies)
 * @returns { root, tier, reason } — or { root: null } when neither volume can
 *          take it, which the caller turns into a 507 rather than a failed write.
 */
function pickUploadRoot(incomingBytes, hotUsedBytes) {
  const size = Number(incomingBytes) || 0;
  const hotFree = freeBytes(HOT_DIR);

  const tooBigForHot = size > HOT_MAX_FILE_BYTES;
  const breaksReserve = hotFree !== null && hotFree - size < HOT_RESERVE_BYTES;
  const breaksAllowance = hotUsedBytes !== null && hotUsedBytes !== undefined && hotUsedBytes + size > HOT_ALLOWANCE_BYTES;

  if (!tooBigForHot && !breaksReserve && !breaksAllowance) {
    return { root: HOT_DIR, tier: "hot", reason: "fits the SSD allowance" };
  }

  const why = tooBigForHot
    ? `is over the ${Math.round(HOT_MAX_FILE_BYTES / 1024 ** 2)} MB per-file SSD limit`
    : breaksReserve
      ? "would breach the SSD free-space reserve"
      : "would exceed the SSD media allowance";
  if (coldReady()) return { root: COLD_DIR, tier: "cold", reason: why };

  // No external drive to fall back on. Allow it only if the hard floor still
  // holds — an over-allowance file is a policy problem, a filled boot disk is an
  // outage.
  if (!breaksReserve) return { root: HOT_DIR, tier: "hot", reason: `${why}, but no backup volume is available` };
  return { root: null, tier: null, reason: `${why} and the external drive is unavailable` };
}

module.exports = {
  HOT_DIR,
  COLD_DIR,
  HOT_MAX_FILE_BYTES,
  HOT_ALLOWANCE_BYTES,
  HOT_RESERVE_BYTES,
  freeBytes,
  pickUploadRoot,
  LEGACY_SUBPATH,
  volumeMounted,
  coldReady,
  invalidateColdCheck,
  readRoots,
  mediaRoots,
  resolveRel,
  hotPathFor,
  coldPathFor,
  relFromAbs,
  tierOf,
};
