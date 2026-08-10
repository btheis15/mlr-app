// Adaptive-bitrate video (HLS) for the MLR media server.
//
// WHAT THIS ADDS OVER THE SINGLE RENDITION
//
// transcode.js already caps every video at one streamable bitrate (~10 Mbps), and
// that plus moving off the throttled Funnel made playback work. What it can't do
// is adapt: a relative on weak cellular at 3 Mbps still has to fetch a 10 Mbps
// file and will stall, and a 4K rung would be unusable for them entirely. HLS cuts
// each video into ~4s segments at several qualities with a playlist, so the player
// measures bandwidth and switches mid-playback — the thing that makes social apps
// feel instant on any connection.
//
// THREE RUNGS, SIZED TO THE SOURCE
//
//   full   source resolution (capped at 4K)   ~11 Mbps   home wifi / fiber
//   720p   1280x720                            ~4 Mbps   decent cellular
//   540p   960x540                             ~1.6 Mbps weak cellular
//
// A rung is SKIPPED when the source is smaller than it — we only ever downscale,
// never upscale, so a 540p clip produces a single-rung ladder rather than three
// blurry copies of itself.
//
// H.264 ON EVERY RUNG, DELIBERATELY. This ffmpeg has libsvtav1 and libx265, and
// AV1 would be meaningfully more efficient per bit — the kind of thing large
// platforms can't afford per-video and this mini can. But AV1/HEVC in HLS needs
// fMP4/CMAF and depends on the viewer's device decoding it; H.264 + MPEG-TS plays
// on everything, including older iPads someone's relative still uses. With
// bandwidth now 6-10x better than it was, universal playback is worth more than
// bitrate efficiency. AV1 remains a clean future upgrade: add a codec option here
// and a second master playlist.
//
// ⚠️⚠️ THE OUTPUT IS A DIRECTORY OF HUNDREDS OF FILES, NONE OF WHICH HAS A
// DATABASE ROW. That is the dangerous part of this feature, not the encoding.
// `<uuid>_hls/` must be understood by four subsystems or they will delete or
// miscount it — see isHlsPath() and its callers in orphan-sweep.js (which
// QUARANTINES unreferenced files), media-usage.js, mirror-sweep.js, and
// /dropbox-zip. Adding a new derived directory means updating all four.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
// ⚠️ DEFAULT OFF. Ladders are useless until the client can play them, and each one
// roughly doubles a video's storage — so generation stays off until the hls.js
// player ships, then flip HLS_ENABLED=on in the mini's .env.
const ENABLED = String(process.env.HLS_ENABLED || "off").toLowerCase() === "on";
const SEGMENT_SECONDS = Number(process.env.HLS_SEGMENT_SECONDS || 4);
const PRESET = process.env.HLS_PRESET || "medium";
const AUDIO_KBPS = Number(process.env.HLS_AUDIO_KBPS || 128);
// Generous: a ladder for a 40s clip takes minutes, and it's a background job on a
// machine with no competing load.
const TIMEOUT_MS = Number(process.env.HLS_TIMEOUT_MS || 60 * 60 * 1000);

/** The suffix that marks a derived HLS directory. */
const HLS_SUFFIX = "_hls";
const MASTER_NAME = "master.m3u8";

// Ordered low -> high. `short` is the SHORT-EDGE pixel count, which is what
// "540p"/"720p" conventionally mean and — critically — is orientation-agnostic.
// ⚠️ Phone video here is mostly PORTRAIT (1080x1920). Treating the rung number as
// HEIGHT made "720p" scale a portrait clip to 405x720, a sliver a third of the
// intended size, while landscape came out correct. Short-edge targeting gives
// 1280x720 for landscape and 720x1280 for portrait, as intended.
// `short: null` means "source resolution".
const RUNGS = [
  { name: "540p", short: 540, kbps: 1600 },
  { name: "720p", short: 720, kbps: 4000 },
  { name: "full", short: null, kbps: Number(process.env.HLS_TOP_KBPS || 11000) },
];
// Cap the "full" rung's short edge (2160 = 4K in either orientation).
const MAX_SHORT = Number(process.env.HLS_MAX_SHORT || 2160);

function run(cmd, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    let out = "";
    let err = "";
    if (capture && child.stdout) child.stdout.on("data", (d) => (out += d));
    if (child.stderr) child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("timed out"));
    }, TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else {
        // Pull the actual error lines out: libx264 prints pages of statistics at
        // the end of even a SUCCESSFUL encode, so a naive stderr tail shows those
        // instead of the failure and makes every error unreadable.
        const lines = String(err || "").split("\n");
        const real = lines.filter((l) => /error|invalid|unable|failed|no such|not found|unrecognized|denied/i.test(l));
        reject(new Error((real.slice(-4).join(" | ") || lines.slice(-3).join(" | ") || `${cmd} exited ${code}`).slice(0, 400)));
      }
    });
  });
}

/** Is this path inside a derived HLS directory? Cheap, string-only. */
function isHlsPath(rel) {
  if (typeof rel !== "string") return false;
  return rel.split("/").some((seg) => seg.endsWith(HLS_SUFFIX));
}

/** Where the ladder for a given served file lives, and its master playlist. */
function hlsDirFor(servedPath) {
  const dir = path.dirname(servedPath);
  const base = path.basename(servedPath, path.extname(servedPath));
  return path.join(dir, `${base}${HLS_SUFFIX}`);
}
function masterPathFor(servedPath) {
  return path.join(hlsDirFor(servedPath), MASTER_NAME);
}

/** Does a COMPLETE ladder already exist? (A master playlist plus a segment.) */
function hasLadder(servedPath) {
  const master = masterPathFor(servedPath);
  try {
    if (!fs.statSync(master).size) return false;
  } catch {
    return false;
  }
  // A master with no segments is a failed/partial run, not a usable ladder.
  const dir = hlsDirFor(servedPath);
  try {
    for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      if (fs.readdirSync(path.join(dir, sub.name)).some((f) => f.endsWith(".ts"))) return true;
    }
  } catch {
    /* unreadable */
  }
  return false;
}

async function inspect(file) {
  const { out } = await run(
    FFPROBE,
    ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate",
     "-show_entries", "format=duration", "-of", "json", file],
    { capture: true },
  );
  const j = JSON.parse(out);
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === "video") || {};
  const fpsRaw = String(v.r_frame_rate || "30/1");
  const [num, den] = fpsRaw.split("/").map(Number);
  return {
    width: Number(v.width || 0),
    height: Number(v.height || 0),
    fps: den ? num / den : 30,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    duration: Number((j.format && j.format.duration) || 0),
  };
}

/** Which rungs make sense for this source — only ever downscaling. */
function ladderFor(info) {
  const srcShort = Math.min(info.width || 0, info.height || 0);
  const out = [];
  for (const r of RUNGS) {
    if (r.short === null) {
      const s = Math.min(srcShort, MAX_SHORT);
      if (s > 0) out.push({ ...r, short: s });
      continue;
    }
    // Skip a rung the source can't fill. The margin stops a 560px source
    // producing a near-identical 540p twin.
    if (srcShort >= r.short * 1.15) out.push({ ...r });
  }
  // Deduplicate (a 720p source makes "720p" and "full" identical).
  const seen = new Set();
  return out.filter((r) => (seen.has(r.short) ? false : (seen.add(r.short), true)));
}

/**
 * Build the HLS ladder beside `servedPath`, into `<uuid>_hls/`.
 *
 * Writes to a temp directory and renames into place, so a partial or failed
 * encode never leaves a half-built ladder that the player would try to use.
 * Never throws — the caller keeps serving the progressive MP4, which always works.
 */
async function buildLadder(servedPath) {
  if (!ENABLED) return { built: false, reason: "HLS_ENABLED=off" };
  if (hasLadder(servedPath)) return { built: false, reason: "ladder already exists" };

  let info;
  try {
    info = await inspect(servedPath);
  } catch (e) {
    return { built: false, reason: `unreadable (${e && e.message})` };
  }
  if (!info.height) return { built: false, reason: "no video stream" };

  const rungs = ladderFor(info);
  if (!rungs.length) return { built: false, reason: "no applicable rungs" };

  const finalDir = hlsDirFor(servedPath);
  const tmpDir = `${finalDir}.part-${process.pid}`;
  await fsp.rm(tmpDir, { recursive: true, force: true });
  // ffmpeg will not create the per-variant directories itself.
  for (let i = 0; i < rungs.length; i++) await fsp.mkdir(path.join(tmpDir, String(i)), { recursive: true });

  // Split the decoded video once and scale each branch, so the source is decoded
  // a single time rather than once per rung.
  const splits = rungs.map((_, i) => `[v${i}]`).join("");
  // Set the SHORT edge to the rung target, whichever axis that is.
  //
  // ⚠️ Orientation is decided HERE IN JS, not with an ffmpeg `if(gt(iw,ih),…)`
  // expression. filter_complex is passed as a single argv element through spawn
  // with no shell, so quote characters in an expression arrive LITERALLY and break
  // the parser ("Error sending frames to consumers: Invalid argument"). We already
  // know the dimensions from inspect(), so concrete numbers are both simpler and
  // immune to that. -2 keeps the other axis proportional and even (H.264 requires
  // even dimensions).
  const portrait = (info.height || 0) >= (info.width || 0);
  const chains = rungs
    .map((r, i) =>
      portrait
        ? `[v${i}]scale=${r.short}:-2[v${i}out]`
        : `[v${i}]scale=-2:${r.short}[v${i}out]`)
    .join(";");
  const filter = `[0:v]split=${rungs.length}${splits};${chains}`;

  const args = ["-y", "-i", servedPath, "-filter_complex", filter];
  rungs.forEach((r, i) => {
    args.push("-map", `[v${i}out]`);
    args.push(`-c:v:${i}`, "libx264", `-b:v:${i}`, `${r.kbps}k`,
              `-maxrate:v:${i}`, `${Math.round(r.kbps * 1.1)}k`,
              `-bufsize:v:${i}`, `${r.kbps * 2}k`);
  });
  if (info.hasAudio) rungs.forEach(() => args.push("-map", "a:0"));

  args.push("-preset", PRESET, "-pix_fmt", "yuv420p");
  if (info.hasAudio) args.push("-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2");
  // Force a keyframe every SEGMENT_SECONDS so segments align across rungs — the
  // player can only switch quality at a segment boundary, and misaligned
  // keyframes make switching stutter or fail outright. Expressed as a time
  // expression rather than -g so it's correct at any frame rate (this library has
  // 30, 60 and 120fps clips).
  args.push("-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SECONDS})`);

  // ⚠️ NO `name=` here. This ffmpeg build rejects it outright ("Invalid keyval
  // name=540p" -> "Could not write header" -> the whole encode fails), so variants
  // are addressed by INDEX and %v expands to 0/1/2. RUNGS is ordered low->high, so
  // directory 0 is always the lowest rung — the master playlist ffmpeg writes
  // carries the real RESOLUTION/BANDWIDTH per variant, so the player never needs
  // the directory name to mean anything.
  const varMap = rungs
    .map((_, i) => (info.hasAudio ? `v:${i},a:${i}` : `v:${i}`))
    .join(" ");

  args.push(
    "-f", "hls",
    "-hls_time", String(SEGMENT_SECONDS),
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",
    "-hls_segment_type", "mpegts",
    "-master_pl_name", MASTER_NAME,
    "-hls_segment_filename", path.join(tmpDir, "%v", "seg_%04d.ts"),
    "-var_stream_map", varMap,
    path.join(tmpDir, "%v", "index.m3u8"),
  );

  try {
    await run(FFMPEG, args);
  } catch (e) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    return { built: false, reason: `encode failed: ${String((e && e.message) || "").slice(0, 240)}` };
  }

  // ffmpeg writes the master alongside the variant playlists; confirm before
  // publishing so we never rename a broken ladder into place.
  const tmpMaster = path.join(tmpDir, MASTER_NAME);
  if (!fs.existsSync(tmpMaster)) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    return { built: false, reason: "no master playlist produced" };
  }

  await fsp.rm(finalDir, { recursive: true, force: true });
  await fsp.rename(tmpDir, finalDir);

  let segments = 0;
  let bytes = 0;
  for (let i = 0; i < rungs.length; i++) {
    try {
      for (const f of await fsp.readdir(path.join(finalDir, String(i)))) {
        if (!f.endsWith(".ts")) continue;
        segments += 1;
        bytes += (await fsp.stat(path.join(finalDir, String(i), f))).size;
      }
    } catch {
      /* counted best-effort */
    }
  }
  return { built: true, dir: finalDir, master: path.join(finalDir, MASTER_NAME), rungs: rungs.map((r) => `${r.short}p`), segments, bytes };
}

module.exports = {
  ENABLED,
  HLS_SUFFIX,
  MASTER_NAME,
  RUNGS,
  isHlsPath,
  hlsDirFor,
  masterPathFor,
  hasLadder,
  buildLadder,
  ladderFor,
  inspect,
};
