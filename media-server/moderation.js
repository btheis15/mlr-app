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
const sharp = require("sharp");

const FM_SERVE_URL = process.env.FM_SERVE_URL || "http://127.0.0.1:8799/v1/chat/completions";
const MOD_MODELS = (process.env.MOD_MODELS || "pcc,system").split(",").map((s) => s.trim()).filter(Boolean);
const MOD_TIMEOUT_MS = Number(process.env.MOD_TIMEOUT_MS || 60000);
const VIDEO_FRAMES = Number(process.env.MOD_VIDEO_FRAMES || 6); // max frames to sample
const VIDEO_EVERY_S = Number(process.env.MOD_VIDEO_EVERY_S || 8); // seconds between frames

// `fm serve` caps the request body at 1 MB, and base64 inflates bytes ~4/3, so
// the raw image we encode must stay well under ~750 KB. We downscale every image
// (and sampled video frame) to a modest longest-edge before base64 — a safety
// classifier doesn't need full resolution, and this is ONLY the copy sent to the
// model. The stored/served media is never touched (photos stay full quality,
// video stays ≤1080p via transcode.js). Without this, full-res phone photos
// (~2 MB base64) are rejected with HTTP 413 before any model even runs.
const MOD_MAX_DIM = Number(process.env.MOD_MAX_DIM || 1024); // longest edge sent to the classifier
const MOD_JPEG_QUALITY = Number(process.env.MOD_JPEG_QUALITY || 80);
const MOD_MAX_IMG_BYTES = Number(process.env.MOD_MAX_IMG_BYTES || 700000); // encoded cap (~930 KB base64, under the 1 MB body limit)

// Adaptive downscale ladder. We ALWAYS classify a downscaled COPY (never the
// stored original, which is served full-quality). fm serve's practical
// body/vision ceiling sits well below 1 MB and can vary, so we start at the
// largest rung and, on an HTTP 413 (too large), drop to the next one down — so
// the copy we actually check is the largest size fm serve will accept.
const MOD_DIM_LADDER = (process.env.MOD_DIM_LADDER || `${MOD_MAX_DIM},768,512`)
  .split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
// Transient failures (PCC/fm-serve blips: "fetch failed", 5xx, timeouts) are
// RETRIED with backoff rather than failing open on the first miss — the old
// single-attempt behavior let unchecked media through whenever the model
// hiccuped (in practice, most uploads went unchecked). fail-open is still the
// LAST resort, only after every size × attempt × model has been exhausted.
const MOD_RETRIES = Number(process.env.MOD_RETRIES || 2); // extra attempts per size after the first
const MOD_RETRY_BACKOFF_MS = Number(process.env.MOD_RETRY_BACKOFF_MS || 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Downscale + re-encode a COPY of the media as JPEG at a given longest-edge, and
// return its base64. Auto-orients via EXIF. This is ONLY the copy sent to the
// classifier — the stored/served file is never touched (photos stay full
// quality; video stays <=1080p via transcode.js).
async function jpegB64AtDim(filePath, dim, quality) {
  const buf = await sharp(filePath, { failOn: "none" })
    .rotate()
    .resize({ width: dim, height: dim, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return buf.toString("base64");
}

// One classify request to one model. Returns a discriminated result:
//   { verdict }    — a parsed { flagged, category, reason, model }
//   { tooLarge }   — HTTP 413: retry at a smaller size (drop a ladder rung)
//   { retry, why } — transient (fetch failed / 5xx / timeout / unparseable): retry
async function classifyOnce(b64, ext, model) {
  const body = {
    stream: false,
    model,
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
  try {
    const resp = await fetch(FM_SERVE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MOD_TIMEOUT_MS),
    });
    if (resp.status === 413) return { tooLarge: true };
    if (!resp.ok) return { retry: true, why: `HTTP ${resp.status}` };
    const data = await resp.json();
    const v = parseVerdict(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    if (v) return { verdict: { ...v, model } };
    return { retry: true, why: "unparseable response" };
  } catch (e) {
    return { retry: true, why: e.message }; // fetch failed / timeout
  }
}

// Check a downscaled COPY of the image. Walk the size ladder (drop to a smaller
// rung on a 413), retry transient failures with backoff, across every model in
// MOD_MODELS. Returns a verdict, or null ONLY after genuinely exhausting every
// size × attempt × model (then the caller fails open). The stored original is
// never modified — we only ever post the original once this copy checks clean.
async function moderateImageFile(filePath) {
  for (const dim of MOD_DIM_LADDER) {
    let b64;
    try {
      b64 = await jpegB64AtDim(filePath, dim, MOD_JPEG_QUALITY);
    } catch (e) {
      console.warn(`[moderate] resize@${dim} failed: ${e.message}`);
      continue;
    }
    // Skip a size we already know is over the encoded cap, unless it's the
    // smallest rung (then just try it — an attempt beats no check at all).
    const isSmallest = dim === MOD_DIM_LADDER[MOD_DIM_LADDER.length - 1];
    if (b64.length > MOD_MAX_IMG_BYTES && !isSmallest) continue;

    for (let attempt = 0; attempt <= MOD_RETRIES; attempt++) {
      let sawTooLarge = false;
      for (const model of MOD_MODELS) {
        const r = await classifyOnce(b64, "jpeg", model);
        if (r.verdict) return r.verdict;
        if (r.tooLarge) { sawTooLarge = true; break; }
        console.warn(`[moderate] ${model}@${dim}px attempt ${attempt + 1} transient: ${r.why}`);
      }
      if (sawTooLarge) break; // drop to the next smaller size
      if (attempt < MOD_RETRIES) await sleep(MOD_RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  return null; // exhausted → fail-open
}

function extractFrames(videoPath, outDir) {
  return new Promise((resolve) => {
    // Scale frames down at extraction so the temp JPEGs (and the base64 we send)
    // stay small; moderateImageFile downscales again as a safety net.
    const args = ["-y", "-i", videoPath, "-vf", `fps=1/${VIDEO_EVERY_S},scale='min(${MOD_MAX_DIM},iw)':-2`, "-frames:v", String(VIDEO_FRAMES), path.join(outDir, "f%02d.jpg")];
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

const TEXT_PROMPT =
  "You are a content-safety filter for a family resort community app used by all ages. " +
  "Decide whether the user-submitted text below contains vulgar, profane, hateful, sexual, " +
  "threatening, or otherwise clearly inappropriate language for a family audience. " +
  "Ordinary friendly, neutral, or mildly negative text is NOT flagged. " +
  "Respond with ONLY a compact JSON object and nothing else: " +
  '{"flagged": true|false, "category": "profanity|hate|sexual|threat|other|none", "reason": "brief phrase"}.';

// Returns { flagged, category, reason, model } or null (null = couldn't check).
async function moderateText(text) {
  const t = String(text || "").trim();
  if (!t) return { flagged: false, category: "none", reason: "" };
  const base = {
    stream: false,
    // The permissive guardrail lets the model actually read sensitive text to
    // classify it (the default guardrail 500s on strong profanity). The word
    // list is the deterministic catch for explicit terms regardless.
    guardrails: "permissive-content-transformations",
    messages: [{ role: "user", content: `${TEXT_PROMPT}\n\nText:\n${t.slice(0, 4000)}` }],
  };
  for (let attempt = 0; attempt <= MOD_RETRIES; attempt++) {
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
        console.warn(`[moderate:text] ${model} attempt ${attempt + 1} failed: ${e.message}`);
      }
    }
    if (attempt < MOD_RETRIES) await sleep(MOD_RETRY_BACKOFF_MS * (attempt + 1));
  }
  return null; // fail-open
}

module.exports = { moderateMedia, moderateText };
