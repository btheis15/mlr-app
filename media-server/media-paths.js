// Map a stored media URL back to the file on this machine.
//
// Every *_media row stores an absolute public URL (…/f/<rel>); the background
// sweeps (thumbnails, capture dates) need the local file behind it. Shared
// rather than copied into each job so the containment check can't drift apart
// between them — a traversal guard that only half the callers have is worse
// than none, since it reads as covered.
//
// No dependencies on purpose: this stays require-able from anywhere.

const fs = require("fs");
const path = require("path");

/**
 * The safe media-root-relative path inside a stored ".../f/<rel>" URL.
 * @returns the rel path, or null if the URL isn't ours or escapes the root.
 */
function relFromStoragePath(storagePath) {
  if (typeof storagePath !== "string") return null;
  const marker = "/f/";
  const i = storagePath.indexOf(marker);
  if (i === -1) return null;
  const rel = storagePath.slice(i + marker.length);
  if (!rel) return null;
  // Reject before touching the filesystem; callers re-verify after resolution —
  // decoded/encoded and symlink-ish inputs can survive a textual check alone.
  if (rel.includes("..") || rel.includes("\0")) return null;
  return rel;
}

/**
 * Map a stored media URL to the file on this machine.
 *
 * `mediaDir` accepts a single directory OR an ordered list of media roots (the
 * two-volume setup — see media-tiers.js). With a list, the FIRST root that
 * actually has the file wins, so a file that has aged off the SSD resolves to
 * its external-drive copy with no caller change. When it exists on none of
 * them, the first root's path is returned so the caller gets a plain ENOENT
 * rather than an ambiguous null.
 *
 * @returns absolute path inside one of the roots, or null if the URL isn't ours
 *          or would escape every root.
 */
function localPathFor(storagePath, mediaDir) {
  const rel = relFromStoragePath(storagePath);
  if (!rel || !mediaDir) return null;
  const roots = Array.isArray(mediaDir) ? mediaDir : [mediaDir];

  let first = null;
  for (const dir of roots) {
    if (!dir) continue;
    const abs = path.resolve(path.join(dir, rel));
    if (!abs.startsWith(path.resolve(dir) + path.sep)) continue; // escaped this root
    if (first === null) first = abs;
    try {
      if (fs.existsSync(abs)) return abs;
    } catch {
      /* unreadable volume (drive asleep/yanked) — try the next root */
    }
  }
  return first;
}

module.exports = { localPathFor, relFromStoragePath };
