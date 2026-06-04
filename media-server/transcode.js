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
const CRF = Number(process.env.VIDEO_CRF || 20); // 18–23; lower = higher quality/bigger
const PRESET = process.env.VIDEO_PRESET || "veryfast"; // x264 speed/efficiency tradeoff
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
     "-show_entries", "format=format_name", "-of", "json", file],
    { capture: true },
  );
  const j = JSON.parse(out);
  const s = (j.streams && j.streams[0]) || {};
  return {
    codec: s.codec_name || "",
    width: Number(s.width || 0),
    height: Number(s.height || 0),
    format: (j.format && j.format.format_name) || "",
  };
}

// Already web-friendly? H.264 in an mp4-family container, within the size cap —
// no point re-encoding (keeps it exactly as the uploader sent it).
function isWebReady(info) {
  const longEdge = Math.max(info.width, info.height);
  const mp4Family = /(^|,)(mp4|m4v|mov|isom|3gp)/.test(info.format);
  return info.codec === "h264" && mp4Family && longEdge > 0 && longEdge <= MAX_LONG_EDGE;
}

// Downscale to fit within MAX_LONG_EDGE on the long side, preserving aspect,
// never upscaling, keeping dimensions even (H.264 requirement). H.264 high /
// yuv420p + faststart = plays in every browser and starts before fully loaded.
async function transcodeVideo(input, output) {
  const e = MAX_LONG_EDGE;
  const vf = `scale=w='min(${e},iw)':h='min(${e},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  await run(FFMPEG, [
    "-y", "-i", input,
    "-vf", vf,
    "-c:v", "libx264", "-preset", PRESET, "-crf", String(CRF), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`,
    "-movflags", "+faststart",
    output,
  ]);
}

const VIDEO_RE = /\.(mov|mp4|m4v|avi|mkv|webm|3gp|3g2|hevc|ts|mts|m2ts|wmv|flv)$/i;

// Given a freshly-saved upload, if it's a video, normalize it to uuid.mp4 in the
// same folder and return that path; otherwise (photo, or transcode unavailable/
// failed) return the original path untouched. Never throws — falls back to the
// original so an upload always succeeds.
async function maybeTranscode(savedPath, mimetype) {
  const isVideo = String(mimetype || "").startsWith("video") || VIDEO_RE.test(savedPath);
  if (!ENABLED || !isVideo) return { path: savedPath, transcoded: false };
  if (!(await ffmpegAvailable())) return { path: savedPath, transcoded: false, reason: "ffmpeg not installed" };
  try {
    const info = await inspectVideo(savedPath).catch(() => null);
    if (info && isWebReady(info)) return { path: savedPath, transcoded: false, reason: "already web-ready" };

    const dir = path.dirname(savedPath);
    const base = path.basename(savedPath, path.extname(savedPath));
    const finalOut = path.join(dir, `${base}.mp4`);
    // If the input itself is uuid.mp4, transcode to a temp name first so we don't
    // read and write the same file, then swap it into place.
    const tmpOut = finalOut === savedPath ? path.join(dir, `${base}.web.mp4`) : finalOut;

    await transcodeVideo(savedPath, tmpOut);

    if (savedPath !== tmpOut && savedPath !== finalOut) { try { fs.unlinkSync(savedPath); } catch {} }
    if (tmpOut !== finalOut) {
      try { fs.unlinkSync(savedPath); } catch {}
      fs.renameSync(tmpOut, finalOut);
    }
    return { path: finalOut, transcoded: true };
  } catch (e) {
    return { path: savedPath, transcoded: false, reason: (e && e.message) || "transcode failed" };
  }
}

module.exports = { maybeTranscode, ffmpegAvailable, ENABLED, MAX_LONG_EDGE, CRF, PRESET };
