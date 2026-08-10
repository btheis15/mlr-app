// Per-volume storage accounting for the owner's "Media server" admin card.
//
// ⚠️ WHY THIS IS ASYNC AND CACHED, not a plain function call.
//
// This used to be a synchronous `fs.readdirSync(recursive) + statSync per file`
// executed INSIDE the /admin/media-server-status request handler. Node is
// single-threaded, so for the whole duration of that walk the entire media
// server stopped: no /f media serving, no uploads, no push, no mailer. At ~1k
// files it was tens of milliseconds and invisible. It scales linearly with file
// count and, on a spun-down external drive, starts with a multi-second spin-up —
// so the stall grew exactly as the library grew, and the trigger was opening the
// admin card, i.e. what you'd do while investigating why the app felt slow.
//
// Now: the walk is fully async (never blocks the loop), runs on a timer plus
// on-demand-if-stale, and the endpoint always answers instantly from cache.
// Two volumes made this non-optional — it would otherwise be two blocking
// walks, one of them on a sleeping disk.

const fsp = require("fs/promises");
const path = require("path");
const { TRASH_SUBDIR } = require("./media-trash");

const PHOTO_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "tiff", "tif", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "avi", "mkv", "hevc"]);

const TTL_MS = 60_000; // a storage meter does not need to be fresher than this
const REFRESH_MS = 5 * 60_000;

function classifyMediaFile(name) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (PHOTO_EXT.has(ext)) return "photo";
  if (VIDEO_EXT.has(ext)) return "video";
  return "other";
}

/**
 * One async walk of `dir`, bucketed by media type.
 *
 * An auto-generated `<uuid>_thumb.jpg` is NOT its own item — its bytes fold into
 * the object it previews, so a photo's size includes its thumbnail and the photo
 * count stays the real number of photos.
 *
 * Thumbnails are matched to their parent by `uuid` ALONE, not `dir + uuid` as
 * before: with two volumes an object and its thumbnail can legitimately sit on
 * different disks (a video on the external drive keeps its tiny preview on the
 * SSD), and a dir-scoped key would count those thumbnails as orphans.
 */
async function walkVolume(dir) {
  const objects = new Map(); // uuid -> "photo" | "video" | "other"
  const thumbs = []; // { uuid, size }
  const buckets = {
    photo: { bytes: 0, files: 0 },
    video: { bytes: 0, files: 0 },
    other: { bytes: 0, files: 0 },
  };
  let totalBytes = 0;
  let totalFiles = 0;

  // Iterative, depth-first, one directory at a time — bounded memory, and every
  // await yields the event loop so requests keep flowing during the walk.
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue; // vanished, unreadable, or the volume went away mid-walk
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // .DS_Store, .Spotlight-V100, …
      // Quarantined media (_trash/) is not app content — counting it would make
      // the storage meter grow every time someone deletes a photo.
      if (e.name === TRASH_SUBDIR) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      let size;
      try {
        size = (await fsp.stat(full)).size;
      } catch {
        continue; // gone between readdir and stat
      }
      const lower = e.name.toLowerCase();
      if (lower.endsWith("_thumb.jpg")) {
        thumbs.push({ uuid: e.name.slice(0, e.name.length - "_thumb.jpg".length), size });
        continue;
      }
      // An `<uuid>_orig.<ext>` is the untouched upload sitting beside its
      // streamable rendition — the SAME object, stored twice. Fold its bytes in
      // like a thumbnail rather than counting a second photo/video, or the meter
      // would claim the library doubled the day originals started being kept.
      const stemNoExt = e.name.slice(0, e.name.length - path.extname(e.name).length);
      if (stemNoExt.endsWith("_orig")) {
        thumbs.push({ uuid: stemNoExt.slice(0, -"_orig".length), size });
        continue;
      }
      const cat = classifyMediaFile(e.name);
      const uuid = e.name.includes(".") ? e.name.slice(0, e.name.lastIndexOf(".")) : e.name;
      objects.set(uuid, cat);
      buckets[cat].bytes += size;
      buckets[cat].files += 1;
      totalBytes += size;
      totalFiles += 1;
    }
  }

  for (const t of thumbs) {
    const cat = objects.get(t.uuid) ?? "photo"; // orphan thumb → count as a photo's
    buckets[cat].bytes += t.size; // bytes only — a thumbnail isn't a separate item
    totalBytes += t.size;
  }

  const labels = { photo: "Photos", video: "Videos", other: "Other files" };
  return {
    totalBytes,
    totalFiles,
    categories: ["photo", "video", "other"]
      .map((k) => ({ key: k, label: labels[k], bytes: buckets[k].bytes, files: buckets[k].files }))
      .filter((c) => c.files > 0),
  };
}

// dir -> { at, data, inFlight }
const cache = new Map();

/**
 * Cached usage for one volume. Returns whatever is cached (possibly null on the
 * very first call, before the startup warm-up finishes) and kicks off a refresh
 * when stale — never awaits the walk on behalf of a request.
 */
function usageFor(dir) {
  if (!dir) return null;
  const entry = cache.get(dir);
  const fresh = entry && Date.now() - entry.at < TTL_MS;
  if (!fresh && (!entry || !entry.inFlight)) void refresh(dir);
  return entry ? entry.data : null;
}

async function refresh(dir) {
  if (!dir) return null;
  const entry = cache.get(dir) || { at: 0, data: null, inFlight: false };
  if (entry.inFlight) return entry.data;
  entry.inFlight = true;
  cache.set(dir, entry);
  try {
    entry.data = await walkVolume(dir);
    entry.at = Date.now();
  } catch (e) {
    console.warn(`[usage] walk failed for ${dir}: ${e && e.message}`);
  } finally {
    entry.inFlight = false;
    cache.set(dir, entry);
  }
  return entry.data;
}

/**
 * Warm the cache at boot and keep it warm, so the admin card is never blank and
 * never triggers a cold walk on the request path. `dirsFn` is re-evaluated each
 * tick because the cold volume can appear or disappear at runtime.
 */
function startUsageRefresh(dirsFn) {
  const tick = async () => {
    for (const dir of dirsFn()) await refresh(dir);
  };
  void tick();
  const timer = setInterval(() => void tick(), REFRESH_MS);
  timer.unref?.();
  return timer;
}

module.exports = { usageFor, refresh, walkVolume, startUsageRefresh };
