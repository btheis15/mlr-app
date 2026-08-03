// Map a stored media URL back to the file on this machine.
//
// Every *_media row stores an absolute public URL (…/f/<rel>); the background
// sweeps (thumbnails, capture dates) need the local file behind it. Shared
// rather than copied into each job so the containment check can't drift apart
// between them — a traversal guard that only half the callers have is worse
// than none, since it reads as covered.
//
// No dependencies on purpose: this stays require-able from anywhere.

const path = require("path");

/**
 * @returns absolute path inside mediaDir, or null if the URL isn't ours or
 *          would escape the media directory.
 */
function localPathFor(storagePath, mediaDir) {
  if (typeof storagePath !== "string" || !mediaDir) return null;
  const marker = "/f/";
  const i = storagePath.indexOf(marker);
  if (i === -1) return null;
  const rel = storagePath.slice(i + marker.length);
  if (!rel) return null;
  // Reject before touching the filesystem, then re-verify after resolution —
  // decoded/encoded and symlink-ish inputs can survive a textual check alone.
  if (rel.includes("..") || rel.includes("\0")) return null;
  const abs = path.resolve(path.join(mediaDir, rel));
  const root = path.resolve(mediaDir) + path.sep;
  return abs.startsWith(root) ? abs : null;
}

module.exports = { localPathFor };
