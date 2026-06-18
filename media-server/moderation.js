// AI content moderation for uploaded media, via the local `fm serve` endpoint.
//
// Sends each uploaded image (and sampled video frames) to Apple's models —
// Private Cloud Compute preferred (better judgment), on-device fallback — and
// returns a { flagged, category, reason, model } verdict. server.js /upload uses
// it to hold flagged media for admin review.
//
// FAIL-OPEN by design: any error (model down, parse failure, ffmpeg missing)
// returns null, and the caller lets the upload through (logged). The member
// "Flag as inappropriate" reports + the admin queue are the backstop. PCC works
// even with the mini's screen locked (it's hosted by the Login-Item `fm serve`),
// so this runs unattended. See APPLE_PCC.md + docs/content-moderation.md.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const FM_SERVE_URL = process.env.FM_SERVE_URL || "http://127.0.0.1:8799/v1/chat/completions";
const MOD_MODELS = (process.env.MOD_MODELS || "pcc,system").split(",").map((s) => s.trim()).filter(Boolean);
const MOD_TIMEOUT_MS = Number(process.env.MOD_TIMEOUT_MS || 60000);
const VIDEO_FRAMES = Number(process.env.MOD_VIDEO_FRAMES || 6); // max frames to sample
const VIDEO_EVERY_S = Number(process.env.MOD_VIDEO_EVERY_S || 8); // seconds between frames

const PROMPT =
  'You are a content-safety filter for a family resort community app used by all ages. ' +
  'Examine the image and decide if it contains content that is sensitive or inappropriate for a general family audience — ' +
  'for example: nudity or sexual content; graphic violence, blood, or gore; weapons brandished threateningly; ' +
  'hateful symbols or gestures; hard-drug use; or other clearly inappropriate material. ' +
  'Ordinary content is NOT flagged: people, families, children, food, drinks, nature, lakes, boats, fishing, ' +
  'buildings, events, screenshots, text, pets. ' +
  'Respond with ONLY a compact JSON object and nothing else: ' +
  '{"flagged": true|false, "category": "nudity|sexual|violence|weapons|hate|drugs|other|none", "reason": "brief phrase"}. ' +
  'If it is ordinary and appropriate, return {"flagged": false, "category": "none", "reason": ""}.';

function parseVerdict(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return {
      flagged: o.flagged === true,
      category: String(o.category || "other"),
      reason: String(o.reason || ""),
    };
  } catch {
    return null;
  }
}

function imageExt(p) {
  const e = path.extname(p).slice(1).toLowerCase();
  return e === "jpg" ? "jpeg" : e || "jpeg";
}

async function classifyImageBase64(b64, ext) {
  const base = {
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/${ext};base64,${b64}` } },
        ],
      },
    ],
  };
  for (const model of MOD_MODELS) {
    try {
      const resp = await fetch(FM_SERVE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, model }),
        signal: AbortSignal.timeout(MOD_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const v = parseVerdict(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
      if (v) return { ...v, model };
    } catch (e) {
      console.warn(`[moderate] ${model} failed: ${e.message}`);
    }
  }
  return null; // fail-open
}

async function moderateImageFile(filePath) {
  let b64;
  try {
    b64 = fs.readFileSync(filePath).toString("base64");
  } catch (e) {
    console.warn(`[moderate] read failed: ${e.message}`);
    return null;
  }
  return classifyImageBase64(b64, imageExt(filePath));
}

function extractFrames(videoPath, outDir) {
  return new Promise((resolve) => {
    const args = ["-y", "-i", videoPath, "-vf", `fps=1/${VIDEO_EVERY_S}`, "-frames:v", String(VIDEO_FRAMES), path.join(outDir, "f%02d.jpg")];
    execFile("ffmpeg", args, { timeout: 120000 }, (err) => {
      if (err) {
        console.warn(`[moderate] ffmpeg frame sampling failed: ${err.message}`);
        resolve([]);
        return;
      }
      let files = [];
      try {
        files = fs.readdirSync(outDir).filter((f) => f.endsWith(".jpg")).map((f) => path.join(outDir, f));
      } catch {}
      resolve(files);
    });
  });
}

async function moderateVideoFile(filePath) {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlr-mod-"));
  } catch {
    return null;
  }
  try {
    const frames = await extractFrames(filePath, dir);
    if (!frames.length) return null; // couldn't sample → fail-open
    for (const f of frames) {
      const v = await moderateImageFile(f);
      if (v && v.flagged) return v; // first bad frame wins
    }
    return { flagged: false, category: "none", reason: "", model: "frames" };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

// kind: "image" | "video". Returns { flagged, category, reason, model } or null
// (null = couldn't check → caller fails open).
async function moderateMedia(filePath, kind) {
  return kind === "video" ? moderateVideoFile(filePath) : moderateImageFile(filePath);
}

module.exports = { moderateMedia };
