// Video transcoding for the MLR media server (runs on the Mac mini).
//
// WHY: phones (iPhones especially) upload HEVC/H.265 .mov files and 4K clips.
// HEVC doesn't play in every browser, and 4K clips are huge — so every person
// scrolling the chat downloads hundreds of MB and some see a black box. This
// normalizes videos to a web-friendly **H.264 MP4, capped at ~1080p**, so they
// play everywhere and load fast. Photos are NOT touched (left full quality).
//
// "1080p at lowest": we only ever *downscale* (never upscale), capping the long
// edge at VIDEO_MAX_LONG_EDGE (1920 → 1080 on the short side for 16:9). A clip
// that's already H.264 MP4 within that size is passed through untouched, so we
// never needlessly re-encode an already-good video.
//
// Requires ffmpeg + ffprobe on the mini:  brew install ffmpeg
// Everything degrades gracefully — if ffmpeg is missing or a transcode fails,
// the original upload is kept as-is, so sending a video never breaks.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const ENABLED = String(process.env.VIDEO_TRANSCODE || "on").toLowerCase() !== "off";
const MAX_LONG_EDGE = Number(process.env.VIDEO_MAX_LONG_EDGE || 1920); // long side cap (px)
const CRF = Number(process.env.VIDEO_CRF || 23); // 18–23; lower = higher quality/bigger
// `veryfast` spends ~2x the bits of `medium` for the same visual quality. The
// transcode is a BACKGROUND job (the upload response never waits on it), so the
// extra ~30s of CPU is free and buys a much smaller, more streamable file.
const PRESET = process.env.VIDEO_PRESET || "medium";
// The hard bitrate ceiling for the playback rendition. This — not CRF — is what
// makes a file streamable: it bounds bytes-per-second regardless of how noisy the
// footage is. 10 Mbps still looks near-identical to a phone original on a phone
// screen, and the untouched original is kept alongside for downloads.
const TARGET_MAX_BPS = Number(process.env.VIDEO_TARGET_MAX_MBPS || 10) * 1_000_000;
const AUDIO_KBPS = Number(process.env.VIDEO_AUDIO_KBPS || 128);
// Synchronous transcode guard so one pathological file can't hang an upload
// forever (default 15 min). Tune via VIDEO_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.VIDEO_TIMEOUT_MS || 15 * 60 * 1000);

function run(cmd, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    let out = "";
    let err = "";
    if (capture && child.stdout) child.stdout.on("data", (d) => (out += d));
    if (child.stderr) child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} reject(new Error("timed out")); }, TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new Error((err || "").slice(-300) || `${cmd} exited ${code}`));
    });
  });
}

// Probe + transcode availability, checked once and cached.
let _available = null;
async function ffmpegAvailable() {
  if (_available !== null) return _available;
  try {
    await run(FFMPEG, ["-version"], { capture: true });
    await run(FFPROBE, ["-version"], { capture: true });
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
}

async function inspectVideo(file) {
  const { out } = await run(
    FFPROBE,
    ["-v", "error", "-select_streams", "v:0",
     "-show_entries", "stream=codec_name,width,height",
     "-show_entries", "format=format_name,bit_rate", "-of", "json", file],
    { capture: true },
  );
  const j = JSON.parse(out);
  const s = (j.streams && j.streams[0]) || {};
  return {
    codec: s.codec_name || "",
    width: Number(s.width || 0),
    height: Number(s.height || 0),
    format: (j.format && j.format.format_name) || "",
    bitrate: Number((j.format && j.format.bit_rate) || 0),
  };
}

/**
 * Is this already a good STREAMING rendition?
 *
 * ⚠️ Bitrate is the thing that matters here, and it used to be missing from this
 * check — which made the whole transcoder skip exactly the files that most needed
 * it. A modern phone records 1080p60 H.264 in an mp4/mov at 20–40 Mbps; that
 * passed the codec + container + resolution tests, was declared "web-ready", and
 * shipped untouched. Playing 36 Mbps needs 4.6 MB/s sustained through the tunnel
 * — several times a typical home UPLOAD pipe — so it buffered endlessly while the
 * disk sat 27x idle. Netflix 1080p is ~5 Mbps and YouTube ~8 for comparison.
 */
function isWebReady(info) {
  const longEdge = Math.max(info.width, info.height);
  const mp4Family = /(^|,)(mp4|m4v|mov|isom|3gp)/.test(info.format);
  const bitrateOk = !info.bitrate || info.bitrate <= TARGET_MAX_BPS * 1.15; // 15% slack
  return info.codec === "h264" && mp4Family && longEdge > 0 && longEdge <= MAX_LONG_EDGE && bitrateOk;
}

/**
 * Build the playback rendition.
 *
 * Frame rate is deliberately PRESERVED (60fps stays 60fps) — the original is kept
 * alongside, so this file only has to be watchable, and halving the frame rate is
 * the most visible way to make motion look worse. The bitrate ceiling
 * (-maxrate/-bufsize) is what guarantees it can actually stream: CRF alone is
 * quality-targeted and will happily emit 36 Mbps on noisy handheld footage.
 *
 * Downscales to fit MAX_LONG_EDGE on the long side, preserving aspect, never
 * upscaling, keeping dimensions even (H.264 requirement). yuv420p + faststart =
 * plays in every browser and starts before it's fully loaded.
 */
async function transcodeVideo(input, output) {
  const e = MAX_LONG_EDGE;
  const vf = `scale=w='min(${e},iw)':h='min(${e},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  await run(FFMPEG, [
    "-y", "-i", input,
    "-vf", vf,
    "-c:v", "libx264", "-preset", PRESET, "-crf", String(CRF), "-pix_fmt", "yuv420p",
    "-maxrate", `${Math.round(TARGET_MAX_BPS / 1000)}k`,
    "-bufsize", `${Math.round((TARGET_MAX_BPS * 2) / 1000)}k`,
    "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`,
    "-movflags", "+faststart",
    output,
  ]);
}

const VIDEO_RE = /\.(mov|mp4|m4v|avi|mkv|webm|3gp|3g2|hevc|ts|mts|m2ts|wmv|flv)$/i;

// ── Keeping the original ────────────────────────────────────────────────────
//
// The transcoder used to REPLACE the uploaded file with its own re-encode, so the
// full-quality original was destroyed at upload time — permanently, for every
// video the family ever posted. That's the wrong trade for irreplaceable footage
// now that storage is plentiful: the rendition only needs to be *watchable*, and
// the original is what you want back for a photo book or a re-edit.
//
// So the original is renamed alongside as `<uuid>_orig.<ext>` and the streamable
// rendition takes the url everything already points at. Nothing in the database
// changes; `/f/…?dl=1` (the Save button) prefers the original when one exists.
const ORIGINAL_SUFFIX = "_orig";

/** Where the untouched original for a given served file lives. */
function originalPathFor(servedPath, ext) {
  const dir = path.dirname(servedPath);
  const base = path.basename(servedPath, path.extname(servedPath));
  return path.join(dir, `${base}${ORIGINAL_SUFFIX}${ext || path.extname(servedPath)}`);
}

/**
 * The stored original for a served file, whatever extension it has (a .mov
 * original sits beside an .mp4 rendition), or null when there isn't one — every
 * video uploaded before this change, plus anything that needed no re-encode.
 */
function findOriginal(servedPath) {
  // ⚠️ Must search BOTH volumes. Originals are deliberately stored on the external
  // drive (they're the largest files and are read only on an explicit download,
  // so keeping them off the SSD is the single biggest storage win) while the
  // playback rendition stays on the SSD. Looking only in the served file's own
  // directory would silently return null and make ?dl=1 hand back the rendition
  // instead of the full-quality file.
  const tiers = require("./media-tiers");
  const rel = tiers.relFromAbs(servedPath);
  const base = path.basename(servedPath, path.extname(servedPath));
  const want = `${base}${ORIGINAL_SUFFIX}`;

  const dirs = [];
  if (rel) {
    const relDir = path.dirname(rel);
    for (const root of tiers.mediaRoots()) dirs.push(path.join(root, relDir === "." ? "" : relDir));
  }
  // Always include the served file's own directory, for dev/legacy layouts that
  // aren't under a configured media root at all.
  const own = path.dirname(servedPath);
  if (!dirs.includes(own)) dirs.push(own);

  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (path.basename(name, path.extname(name)) === want) return path.join(dir, name);
    }
  }
  return null;
}

// Given a freshly-saved upload, if it's a video, produce a streamable rendition
// at uuid.mp4 in the same folder and KEEP the untouched upload beside it as
// uuid_orig.<ext>. Returns the path to serve; otherwise (photo, or transcode
// unavailable/failed) returns the original path untouched. Never throws — falls
// back to the original so an upload always succeeds.
//
// ⚠️ THE ORIGINAL IS NEVER DELETED ANY MORE. This used to overwrite the upload
// with its own re-encode ("re-encoded in place"), so the full-quality file the
// family actually shot was destroyed seconds after arriving — irreversibly, for
// every video ever posted, including any 4K footage that got downscaled to 1080p
// on the way through. Storage is cheap and the footage isn't reproducible, so the
// rendition is now purely a *playback convenience* sitting next to the real file.
// `/f/…?dl=1` (the Save button) serves the original when one exists.
//
// `keepOriginalUrl` matters for the caller that has already handed the ORIGINAL
// url out (server.js's background transcode, so the upload response doesn't wait
// on ffmpeg): with a changed extension the original must keep serving at its old
// url until stored references are repointed, so the rename to _orig is deferred
// and returned as `finishSwap()` for the caller to run after repointing.
async function maybeTranscode(savedPath, mimetype, { keepOriginalUrl = false } = {}) {
  const isVideo = String(mimetype || "").startsWith("video") || VIDEO_RE.test(savedPath);
  if (!ENABLED || !isVideo) return { path: savedPath, transcoded: false };
  if (!(await ffmpegAvailable())) return { path: savedPath, transcoded: false, reason: "ffmpeg not installed" };
  try {
    const info = await inspectVideo(savedPath).catch(() => null);
    if (info && isWebReady(info)) {
      // Already streamable — no rendition needed, and the upload IS the original.
      return { path: savedPath, transcoded: false, reason: "already streamable" };
    }

    const dir = path.dirname(savedPath);
    const ext = path.extname(savedPath);
    const base = path.basename(savedPath, ext);
    const finalOut = path.join(dir, `${base}.mp4`);
    const origDest = path.join(dir, `${base}${ORIGINAL_SUFFIX}${ext}`);
    // Never read and write the same path in one ffmpeg run.
    const tmpOut = finalOut === savedPath ? path.join(dir, `${base}.web.mp4`) : finalOut;

    await transcodeVideo(savedPath, tmpOut);

    if (finalOut === savedPath) {
      // Same extension (uuid.mp4 in → uuid.mp4 out). Move the ORIGINAL aside
      // first, then rename the rendition into place. Order matters: if we
      // renamed the rendition first we'd clobber the original and lose it.
      // Both renames are same-directory and atomic, and the served url never
      // points at a partial file.
      fs.renameSync(savedPath, origDest);
      fs.renameSync(tmpOut, finalOut);
      return { path: finalOut, transcoded: true, pathChanged: false, originalPath: origDest };
    }

    // Extension changed (.mov in → .mp4 out). The original is still serving at
    // its own url, so it can only be moved aside once the caller has repointed
    // stored references at the new one.
    if (!keepOriginalUrl) {
      fs.renameSync(savedPath, origDest);
      return { path: finalOut, transcoded: true, pathChanged: true, originalPath: origDest };
    }
    return {
      path: finalOut,
      transcoded: true,
      pathChanged: true,
      // Call AFTER repointing references — moves the original aside instead of
      // deleting it, which is the whole point of this change.
      finishSwap: () => {
        try {
          fs.renameSync(savedPath, origDest);
          return origDest;
        } catch {
          return null;
        }
      },
    };
  } catch (e) {
    return { path: savedPath, transcoded: false, reason: (e && e.message) || "transcode failed" };
  }
}

module.exports = { maybeTranscode, ffmpegAvailable, ENABLED, MAX_LONG_EDGE, CRF, PRESET, TARGET_MAX_BPS, ORIGINAL_SUFFIX, originalPathFor, findOriginal, inspectVideo, transcodeVideo };
