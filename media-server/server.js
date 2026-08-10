// Muskellunge Lake Resort — media server (runs on the Mac mini).
//
// Stores + serves the post photos/videos AND committee-chat attachments so the
// app isn't capped by cloud storage. Uploads are gated to signed-in family
// members (the Supabase access token is validated against the cloud project).
// Put a STABLE public HTTPS tunnel in front (Tailscale Funnel or a named
// Cloudflare Tunnel) and set PUBLIC_URL to that address — the app stores the
// returned URLs, so it must not change. See README.md.
//
// ── Storage layout (organized) ───────────────────────────────────────────────
// Everything lives under MEDIA_DIR. New uploads are filed by feature + month so
// the folder never becomes one giant flat pile:
//
//   <MEDIA_DIR>/
//     posts/<YYYY-MM>/<uuid>.<ext>          ← Posts feed photos/videos
//     posts/legacy/<uuid>.<ext>             ← files from before this layout
//     chat/<committee-slug>/<YYYY-MM>/…     ← committee-chat attachments
//
// The upload route picks the folder from ?category= (and ?room= for chat); it
// returns the full URL, which the app saves verbatim. Reads are served from the
// whole tree under /f, PLUS a fallback mount on posts/legacy so the old flat
// "/f/<uuid>.<ext>" URLs that are already saved in the database keep resolving
// after we tidy those files away. Nothing already stored ever breaks.

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { execFileSync } = require("child_process");
const { maybeTranscode, ffmpegAvailable, ENABLED: TRANSCODE_ENABLED, MAX_LONG_EDGE, CRF, TARGET_MAX_BPS, ORIGINAL_SUFFIX, findOriginal } = require("./transcode");
const { moderateMedia, moderateText, moderationStatus } = require("./moderation");
const { enqueueRecheck, startBackfill, moderationStats, clearGaveUp, noteScanned, noteNeedsReview } = require("./moderation-backfill");
const { makeThumbnail, thumbPathFor } = require("./thumbnail");
const { makeDisplayCopy } = require("./display");
const { buildLadder, isHlsPath, masterPathFor, hasLadder, ENABLED: HLS_ENABLED, MASTER_NAME } = require("./hls");
const streamLoad = require("./stream-load");
const mediaAuth = require("./media-auth");
const { extractCapturedAt } = require("./captured-at");
const { startCapturedAtBackfill } = require("./captured-at-backfill");
const { startThumbnailBackfill } = require("./thumbnail-backfill");
const { embedOne, toVectorLiteral } = require("./embed-client");
const { start: startSearchIndexer } = require("./search-indexer");
const tiers = require("./media-tiers");
const { usageFor, startUsageRefresh } = require("./media-usage");
const { startMirrorSweep, deleteFileEverywhere, listRelFiles } = require("./mirror-sweep");
const { isTrashPath, trashSummary } = require("./media-trash");
const { startOrphanSweep } = require("./orphan-sweep");

const SERVER_STARTED_AT = new Date().toISOString();
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""; // ⚠️ powerful — admin endpoints only

// Known-good production origins for the app, used ONLY as a fallback when
// ALLOWED_ORIGINS isn't set. Keep this list current with the app's deploy
// URLs so a blank/misconfigured .env still fails CLOSED (a fixed, real
// allow-list) instead of reflecting every origin.
const DEFAULT_ALLOWED_ORIGINS = ["https://mlr-app-omega.vercel.app"];
const ALLOWED = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!ALLOWED.length) {
  console.warn(
    `⚠ ALLOWED_ORIGINS is not set — defaulting to the known production origins (${DEFAULT_ALLOWED_ORIGINS.join(", ")}). ` +
      "Set ALLOWED_ORIGINS in .env to override (comma-separated). This server no longer reflects arbitrary origins."
  );
  ALLOWED.push(...DEFAULT_ALLOWED_ORIGINS);
}
// Per-file cap (MB) — 50 GB, i.e. "effectively unlimited, it's a video."
//
// ⚠️ This number does NOT mean a 50 GB upload will succeed. Two other things bind
// first, and both are outside this file:
//   • BANDWIDTH. 50 GB over a residential uplink is hours; see the
//     UPLOAD_TIMEOUT_MS note in /upload. On the LAN it's minutes.
//   • THE TUNNEL in front of us (Tailscale Funnel / Cloudflare Tunnel) may cap
//     request body size on its own, and would reject the upload before it ever
//     reaches this process.
// What the cap DOES do is stop the server from rejecting a large file outright.
// Where that file physically lands is decided by tiers.pickUploadRoot, not here.
const MAX_MB = Number(process.env.MAX_MB || 50 * 1024);
// MEDIA_DIR is the HOT volume (the mini's SSD): every upload lands here and every
// read is served from here first. MEDIA_COLD_DIR is the external backup mirror.
// See media-tiers.js for how one URL space spans both.
const MEDIA_DIR = tiers.HOT_DIR;
const COLD_DIR = tiers.COLD_DIR;
const LEGACY_DIR = path.join(MEDIA_DIR, "posts", "legacy");

// The hot volume is where we WRITE, so if it's a mount that isn't mounted we
// must not start: mkdirSync below would recreate the path as an empty folder on
// whatever disk is underneath, and then every existing photo 404s while new
// uploads silently misfile. Fail loud — launchd (KeepAlive + 10s
// ThrottleInterval) retries until the drive is back. Normally MEDIA_DIR is an
// internal path and this never fires; it's kept for the case where someone
// points the hot volume at /Volumes on purpose.
if (MEDIA_DIR.startsWith("/Volumes/") && !tiers.volumeMounted(MEDIA_DIR)) {
  console.error(
    `FATAL: MEDIA_DIR is ${MEDIA_DIR} but that volume is not mounted. ` +
      `Refusing to start so media isn't misfiled onto the internal disk — plug in / remount the drive.`
  );
  process.exit(1);
}

// The COLD volume is different: it holds backups and any file that has aged off
// the SSD, so losing it is a degradation, not a reason to take the whole app
// down over a missing drive. Warn, serve everything the SSD still has, and let
// the mirror sweep catch up whenever it returns. tiers.coldReady() re-checks at
// runtime, so a replug needs no restart.
if (COLD_DIR && !tiers.coldReady()) {
  console.warn(
    `⚠ MEDIA_COLD_DIR is ${COLD_DIR} but that volume is not mounted. Running DEGRADED: ` +
      `serving from the SSD only, no backups written, and anything stored only on the external drive will 404 until it's back.`
  );
} else if (!COLD_DIR) {
  console.warn("⚠ MEDIA_COLD_DIR is not set — media has no backup copy.");
}

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(LEGACY_DIR, { recursive: true });
if (COLD_DIR && tiers.coldReady()) {
  try {
    fs.mkdirSync(path.join(COLD_DIR, "posts", "legacy"), { recursive: true });
  } catch (e) {
    console.warn(`⚠ could not prepare the backup volume: ${e && e.message}`);
  }
}

const app = express();
app.disable("x-powered-by");
// Trust the one reverse-proxy hop in front of us (Tailscale Funnel / a named
// Cloudflare Tunnel, per README). Without this, express (and the rate limiter
// below) sees every request as coming from localhost — the tunnel's local
// forward — which would rate-limit the whole family as a single "IP".
app.set("trust proxy", 1);
// Baseline security headers. CSP is off — this server never serves HTML pages
// with inline scripts to protect (just JSON + static media/assets), and a
// default CSP would fight the static file responses. COEP is off and CORP is
// widened to cross-origin so the Next app (a different origin) can still
// <img>/<video> embed the media this server serves.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors({ origin: ALLOWED, methods: ["GET", "POST", "OPTIONS"] }));

// Rate limiting — fail-safe defaults sized for a family posting fest photos in
// bursts, not for abuse. Keyed per-IP (express-rate-limit's default). A modest
// global floor on everything, plus tighter limits on the routes worth abusing.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // Don't count uptime checks — OR uploads — against anyone. Uploads are
  // deliberately UNLIMITED (see below): a whole family shares one WiFi/IP at the
  // lake (and can collapse to a single key behind the tunnel), so a big album
  // dump would otherwise trip this floor too. /upload is still auth'd,
  // magic-byte-sniffed, and MAX_MB-capped, so removing the count cap opens no
  // abuse hole — disk space (watchable on the Admin storage meter) is the ceiling.
  skip: (req) => req.path === "/health" || req.path === "/upload",
});
// NOTE: uploads are intentionally NOT rate-limited. The core use case is dumping
// a whole album (a fest/outing is easily hundreds of photos from one phone), and
// any per-hour cap 429'd real family uploads mid-dump. Safety comes from auth +
// magic-byte sniff + MAX_MB, not a count limit.
const moderateTextLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // 60/min — one per caption keystroke-pause is plenty
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." },
});
const geocodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30, // 30/min — a member editing their address a few times, not a geocoding proxy
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." },
});
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20, // 20 invite-batch requests/hour/IP — plenty for an admin, not for a mistaken mass-paste
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many invite requests. Try again in a bit." },
});
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // 60 searches/min/IP — plenty for a person typing, not a scraping tool
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many searches. Try again shortly." },
});
app.use(globalLimiter);

// Lightweight request log (method, path, origin, body size, auth present) so
// upload problems are diagnosable from logs/server.log.
app.use((req, res, next) => {
  if (req.url !== "/health") {
    // ⚠️ Log the RESPONSE STATUS, not just the request. This line used to record only
    // what came in, which made a media-auth rollout undebuggable: the log showed the
    // client asking for a token and later requesting photos unsigned, with no way to
    // tell whether /media-token had answered 200, 401 or 403 — so every diagnosis was
    // a guess. `tok` distinguishes "client never had a token" from "client sent one we
    // rejected", which are completely different bugs with the same broken-image symptom.
    const started = Date.now();
    const tok = /[?&]t=/.test(req.url) ? "tok=yes" : "tok=no";
    // ⚠️ Snapshot the path NOW, don't read req.path inside the finish handler.
    // Express temporarily rewrites req.url to strip the mount prefix while a mounted
    // handler runs, and `finish` fires from INSIDE express.static — so reading it late
    // logged `/posts/x.jpg` for a request to `/f/posts/x.jpg`. Every grep for "/f/"
    // then came back empty and looked like "no media traffic at all", which is a
    // genuinely misleading thing for a debugging log to say.
    //
    // req.path (not originalUrl) so the ?t= token stays out of the logfile.
    const at = req.path;
    res.on("finish", () => {
      console.log(
        `[req] ${new Date().toISOString()} ${req.method} ${at} -> ${res.statusCode} ${Date.now() - started}ms origin=${req.headers.origin || "-"} len=${req.headers["content-length"] || "-"} auth=${req.headers.authorization ? "yes" : "no"} ${tok}`
      );
    });
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Address geocoding for the member-profile address editor. US Census (free, no
// key, strong US residential coverage) for US addresses; OpenStreetMap Nominatim
// for everywhere else. Server-side so the browser avoids CORS and we can send a
// proper User-Agent. Returns { found, lat, lon, label }. Signed-in only (it's a
// free proxy to two outside geocoders — no reason to let it be hit anonymously),
// same requireUser gate as uploads.
app.get("/geocode", geocodeLimiter, requireUser, async (req, res) => {
  const country = String(req.query.country || "US").toUpperCase();
  const q = String(req.query.q || "").trim().slice(0, 300);
  if (!q) return res.json({ found: false });
  try {
    if (country === "US") {
      const u = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
      const d = await (await fetch(u)).json();
      const m = (d && d.result && d.result.addressMatches) || [];
      if (m[0]) return res.json({ found: true, lat: Number(m[0].coordinates.y), lon: Number(m[0].coordinates.x), label: m[0].matchedAddress });
      return res.json({ found: false });
    }
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const d = await (await fetch(u, { headers: { "User-Agent": "MLR-app (resort member directory)", Accept: "application/json" } })).json();
    if (Array.isArray(d) && d[0]) return res.json({ found: true, lat: Number(d[0].lat), lon: Number(d[0].lon), label: d[0].display_name });
    return res.json({ found: false });
  } catch (e) {
    return res.json({ found: false, error: String((e && e.message) || e) });
  }
});

// Public read of media. express.static honours HTTP Range requests, so video
// seeking/streaming works, and sets long-lived caching (filenames are unique).
// 1) the whole organized tree (posts/<ym>/…, chat/<slug>/<ym>/…); 2) a fallback
// on posts/legacy so already-saved flat "/f/<uuid>.<ext>" URLs still resolve;
// 3) a final 404 so misses don't hang.
const staticOpts = { maxAge: "365d", immutable: true };
// Opt-in download: `/f/…?dl=1` streams the exact same bytes but with a
// Content-Disposition: attachment header, so the browser SAVES the file instead
// of opening it inline. Set here (before express.static) because static ignores
// the query string. Works cross-origin — unlike the HTML `download` attribute,
// which browsers ignore for a cross-origin href (the app and the mini are
// different origins). Drop boxes (0171) use this so members can pull originals
// for photo books etc.; nothing else links with `?dl`, so inline stays default.
// ⭐ MEMBERS ONLY. A signed token is required for every media read. Must be the
// FIRST thing on /f so nothing below it can leak a byte. See media-auth.js for why
// the token rides in the query string rather than a header or a cookie.
app.use("/f", mediaAuth.requireMediaToken);

// Quarantine (_trash/) lives INSIDE the media folder, which is also a static
// root — so it has to be blocked explicitly or deleted media would stay
// downloadable for its whole 7-day hold. Must come BEFORE the static mounts.
app.use("/f", (req, res, next) => {
  const rel = decodeURIComponent(req.path.replace(/^\/+/, ""));
  if (isTrashPath(rel)) return res.status(404).json({ error: "Not found." });
  next();
});
// Opt-in download. Two things happen here:
//
// 1. Content-Disposition: attachment, so the browser SAVES rather than opens.
// 2. ⭐ THE ORIGINAL IS SERVED, NOT THE PLAYBACK RENDITION. A video's url points
//    at a bitrate-capped rendition built for streaming; the untouched file the
//    family actually shot sits beside it as `<uuid>_orig.<ext>`. Saving for a
//    photo book or a re-edit should hand back the real thing. Falls through to
//    the rendition when there's no original (anything uploaded before originals
//    were kept, or a file that never needed re-encoding).
app.use("/f", (req, res, next) => {
  if (req.query.dl == null) return next();
  const rel = decodeURIComponent(req.path.replace(/^\/+/, ""));
  const served = tiers.resolveRel(rel);
  const original = served ? findOriginal(served) : null;
  if (original) {
    // Name the download after the ORIGINAL's extension (a .mov original behind
    // an .mp4 rendition), minus the internal _orig marker.
    const name = path.basename(original).replace(`${ORIGINAL_SUFFIX}${path.extname(original)}`, path.extname(original));
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.\-]/g, "_")}"`);
    return res.sendFile(original, (err) => {
      if (err && !res.headersSent) next();
    });
  }
  const base = path.basename(req.path) || "download";
  res.setHeader("Content-Disposition", `attachment; filename="${base.replace(/[^\w.\-]/g, "_")}"`);
  next();
});
// The tier fallback IS this chain. express.static passes to the next handler on
// a miss, so a file that lives only on the external drive is found by root 3/4
// with no lookup, no database column, and no change to its URL. That's what
// makes dropping an SSD copy safe once it's mirrored — the request simply falls
// one root further down.
//
// The cold roots are resolved per-request (not captured at boot) so unplugging
// or replugging the drive needs no restart.
// Meter what actually leaves /f, and let congestion shape quality.
//
// Two jobs, both before the static handlers:
//  1. Record real bytes delivered per response, so `currentLoad()` reflects
//     photos, downloads and zips competing with video rather than a video-only
//     guess.
//  2. Serve a REDUCED master playlist while the pipe is under pressure with
//     several viewers active. Capping at the manifest is what makes this
//     effective without a cooperating client — a player can only choose a variant
//     the manifest offers, so native iOS players and older app builds get shaped
//     too.
app.use("/f", (req, res, next) => {
  res.on("finish", () => {
    const sent = Number(res.getHeader("content-length")) || res.socket?.bytesWritten || 0;
    if (sent > 0) streamLoad.record(req, Math.min(sent, 2 ** 31));
  });
  next();
});

app.get(new RegExp(`^/f/.*${MASTER_NAME.replace(".", "\\.")}$`), (req, res, next) => {
  const rel = decodeURIComponent(req.path.replace(/^\/f\//, ""));
  const abs = tiers.resolveRel(rel);
  if (!abs || !fs.existsSync(abs)) return next();
  streamLoad.touch(req);
  const load = streamLoad.currentLoad();
  let body;
  try {
    body = fs.readFileSync(abs, "utf8");
  } catch {
    return next();
  }
  if (load.capping) {
    const capped = streamLoad.capMasterPlaylist(body, load.maxRungs);
    if (capped !== body) {
      console.log(
        `[load] capping to ${load.maxRungs} rung(s): ${load.viewers} viewers, ` +
          `${load.mbps} Mbps of ${load.capacityMbps} (pressure ${load.pressure})`
      );
      body = capped;
    }
  }
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  // Never cache a manifest whose contents depend on live load.
  res.setHeader("Cache-Control", "no-store");
  return res.send(body);
});

// Segment/playlist content types — express.static's mime table doesn't know .m3u8
// or .ts, and a wrong type makes some players refuse to load the stream at all.
app.use("/f", (req, res, next) => {
  if (req.path.endsWith(".m3u8")) res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  else if (req.path.endsWith(".ts")) res.setHeader("Content-Type", "video/mp2t");
  next();
});

app.use("/f", express.static(MEDIA_DIR, staticOpts));
app.use("/f", express.static(LEGACY_DIR, staticOpts));
app.use("/f", (req, res, next) => {
  if (!tiers.coldReady()) return next();
  return express.static(COLD_DIR, staticOpts)(req, res, () =>
    express.static(path.join(COLD_DIR, "posts", "legacy"), staticOpts)(req, res, next)
  );
});
app.use("/f", (_req, res) => res.status(404).json({ error: "Not found." }));

// Small static app assets shipped with the repo (e.g. pay-method logos). Served
// from here so they live on the mini (free) instead of Supabase storage.
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "30d" }));

// Download drop-box media as one .zip (0171) — for photo books, etc. Two modes:
//   • GET  /dropbox-zip?box=&token=            → the WHOLE folder (dropbox/<box>/)
//   • POST /dropbox-zip  (box, token, path[])  → just the SELECTED files
// The POST mode is a plain form submit (many `path` fields + the token as hidden
// inputs), so a selection of any size rides along without URL-length limits and
// the browser saves the streamed zip natively (no JS blob buffering). Auth via
// token in the query/body (an <a>/<form> download can't set an Authorization
// header) OR the usual Bearer header; validated against Supabase like
// requireUser. Streams straight from the system `zip`, nothing buffered.
async function serveDropboxZip(req, res, token, box, name, relPaths) {
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(401).json({ error: "Sign in required." });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return res.status(401).json({ error: "Invalid or expired session." });
  } catch {
    return res.status(503).json({ error: "Couldn't reach the auth service." });
  }
  if (!box) return res.status(400).json({ error: "Missing folder." });

  // Build the zip file list. Two volumes mean a single `cwd` no longer works —
  // an album's files can be split across the SSD and the external drive — so
  // every entry is resolved to an ABSOLUTE path on whichever volume has it
  // (tiers.resolveRel prefers hot) and handed to zip with `-j`, which flattens
  // and therefore ignores cwd entirely. Filenames are UUIDs, so flattening can't
  // collide.
  //
  // With an explicit list (the normal path — the client sends every item's
  // media-root-relative path) each entry is resolved under the MEDIA ROOT, not
  // the box folder, so an album can include files stored ANYWHERE in the tree:
  // a Feed post's photo added to an album lives under posts/, not dropbox/<box>/.
  // With NO list (fallback) enumerate the box's own folder on BOTH volumes and
  // union them, hot winning, so a partially-mirrored album still downloads whole.
  const abs = [];
  if (relPaths && relPaths.length) {
    for (const raw of relPaths) {
      if (typeof raw !== "string" || !raw) continue;
      const clean = path.normalize(raw).replace(/^[/\\]+/, "");
      const resolved = tiers.resolveRel(clean); // null if it escapes every root
      if (!resolved) continue;
      try {
        // Prefer the untouched original over the streamable rendition — a whole-
        // album zip is exactly the photo-book case where full quality matters,
        // same rule as ?dl=1 on a single file.
        const original = findOriginal(resolved);
        const pick = original || resolved;
        if ((await fsp.stat(pick)).isFile()) abs.push(pick);
      } catch {
        /* gone from every volume — skip */
      }
    }
    if (!abs.length) return res.status(400).json({ error: "No files selected." });
  } else {
    const seen = new Set();
    for (const root of tiers.mediaRoots()) {
      const boxDir = path.join(root, "dropbox", box);
      let rels = [];
      try {
        rels = await listRelFiles(boxDir);
      } catch {
        continue; // not on this volume
      }
      // One entry per real item. The folder also holds derived files —
      // `_thumb.jpg` previews and `_orig.<ext>` full-quality uploads — and a zip
      // wants NEITHER the tiny preview NOR both copies of the same video. Group
      // by stem, then prefer the original over its rendition.
      const byStem = new Map(); // parent stem -> chosen rel
      for (const rel of rels) {
        const name = path.basename(rel);
        // Never zip adaptive-streaming internals — a viewer wants the video, not
        // 300 four-second fragments of it.
        if (isHlsPath(rel)) continue;
        const noExt = name.slice(0, name.length - path.extname(name).length);
        if (noExt.endsWith("_thumb")) continue; // never zip previews
        const isOriginal = noExt.endsWith("_orig");
        const stem = path.join(path.dirname(rel), isOriginal ? noExt.slice(0, -"_orig".length) : noExt);
        if (isOriginal || !byStem.has(stem)) byStem.set(stem, rel); // original wins
      }
      for (const [stem, rel] of byStem) {
        if (seen.has(stem)) continue; // already taken from a higher-priority tier
        seen.add(stem);
        abs.push(path.join(boxDir, rel));
      }
    }
    if (!abs.length) return res.status(404).json({ error: "Nothing to download yet." });
  }
  const args = ["-j", "-q", "-", ...abs]; // -j flatten, - = write archive to stdout

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${(name || box)}.zip"`);

  const { spawn } = require("child_process");
  const zip = spawn("zip", args); // no cwd — `-j` + absolute paths span both volumes
  zip.stdout.pipe(res);
  zip.stderr.on("data", (d) => console.warn(`[dropbox-zip] ${String(d).trim()}`));
  zip.on("error", (e) => {
    console.error(`[dropbox-zip] spawn error: ${e.message}`);
    if (!res.headersSent) res.status(500).json({ error: "Couldn't build the download." });
  });
  req.on("close", () => {
    try { zip.kill(); } catch {}
  });
}

function bearerToken(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  return m ? m[1] : "";
}

app.get("/dropbox-zip", (req, res) => {
  const token = String(req.query.token || "").trim() || bearerToken(req);
  serveDropboxZip(req, res, token, safeSeg(req.query.box, ""), safeSeg(req.query.name, "") || safeSeg(req.query.box, ""), null);
});

app.post("/dropbox-zip", express.urlencoded({ extended: true, limit: "512kb" }), (req, res) => {
  const b = req.body || {};
  const token = String(b.token || "").trim() || bearerToken(req);
  let paths = b.path ?? [];
  if (typeof paths === "string") paths = [paths];
  serveDropboxZip(req, res, token, safeSeg(b.box, ""), safeSeg(b.name, "") || safeSeg(b.box, ""), Array.isArray(paths) ? paths : []);
});

// Public privacy policy (App Store requires a reachable, no-login URL). Served
// from the repo file so it deploys with a normal git pull. → <PUBLIC_URL>/privacy
// Hand a logged-in member the media token. requireUser validates their Supabase
// session, so this is the one place membership is actually checked — everything
// under /f then just verifies the signature.
app.get("/media-token", requireUser, async (req, res) => {
  // ⭐ APPROVAL GATE. A verified Supabase login is NOT enough — anyone can sign up
  // with any email address. Only a member an admin has approved gets a media
  // token, which is what makes the albums genuinely members-only rather than
  // "anyone who registered".
  //
  // Degrades gracefully while the migration hasn't run: an absent `approved`
  // column means every existing member keeps working rather than the whole app
  // losing its photos. Same pre-migration idiom as the rest of this codebase.
  const approved = await isApprovedMember(req);
  if (approved === false) {
    return res.status(403).json({
      error: "An admin needs to approve your account before you can see photos.",
      pendingApproval: true,
    });
  }
  const { token, expiresAt } = mediaAuth.issueToken();
  // ⚠️⚠️ NO-STORE, AND NO ETAG. This previously sent `private, max-age=600`, which
  // broke every photo in the app in a way that took hours to find.
  //
  // The body is byte-identical for the whole 24h window, so Express's automatic ETag
  // was stable. After the 600s freshness lapsed the browser revalidated with
  // If-None-Match and got a **304 Not Modified** — and `fetch()` reports `res.ok ===
  // false` for a 304, so ensureMediaToken() hit its `if (!res.ok) return null` branch
  // and concluded it had NO TOKEN. Every media URL then rendered unsigned and 403'd,
  // while /media-token itself looked perfectly healthy in the logs (alternating 200s
  // and 304s). Observed live: 104 consecutive `tok=no` 403s on a photo album.
  //
  // Caching bought nothing anyway — the client already persists the token in
  // localStorage for its full 24h life, so the HTTP cache was a redundant second
  // layer whose only effect was this failure. A short-lived bearer credential should
  // not sit in the browser's HTTP cache regardless.
  //
  // Written with res.end() rather than res.json() BECAUSE res.json() -> res.send()
  // unconditionally computes an ETag, and removeHeader() before it is too late (send
  // adds it afterward). res.end() skips that path entirely, so this response carries
  // no validator at all and cannot be revalidated into a 304.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ token, expiresAt, ttlHours: mediaAuth.TTL_MS / 3600000 }));
});

/**
 * Is the caller an admin-approved member?
 * @returns true / false, or null when it can't be determined (pre-migration or a
 *          transient error) — callers treat null as "allow", so a misconfiguration
 *          degrades to the previous behaviour instead of blanking every photo.
 */
async function isApprovedMember(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m || !SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    // Resolve the caller from their own token, then read the flag with the
    // service role (profiles is not readable by an unapproved user by design).
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
    });
    if (!who.ok) return false;
    const uid = (await who.json())?.id;
    if (!uid) return false;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=approved,is_admin`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return null; // column missing (pre-migration) or transient — allow
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return false;
    if (rows[0].is_admin) return true; // an admin is implicitly approved
    if (rows[0].approved === undefined) return null; // pre-migration
    return rows[0].approved === true;
  } catch {
    return null;
  }
}

// Live load, for the client to cap hls.js mid-playback (autoLevelCapping). Public
// and deliberately trivial: it exposes an aggregate throughput number and a viewer
// count, nothing about who is watching what.
app.get("/media-load", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(streamLoad.currentLoad());
});

app.get("/privacy", (_req, res) => res.sendFile(path.join(__dirname, "privacy-policy.html")));

// Where a given upload is filed. Driven by query params (available immediately,
// unlike multipart body fields which depend on field order). Inputs are
// sanitized hard — they become real folder names, so only [a-z0-9_-].
function safeSeg(value, fallback) {
  const v = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return v || fallback;
}
function uploadSubdir(req) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const category = safeSeg(req.query.category, "posts");
  if (category === "chat") {
    return path.join("chat", safeSeg(req.query.room, "general"), ym);
  }
  if (category === "work") {
    return path.join("work", ym); // work-item attachments
  }
  if (category === "dropbox") {
    // Shared drop-box folders (0171): file under dropbox/<box-id>/<ym>/. The
    // box id rides in ?room, sanitized to [a-z0-9_-] like every other segment.
    return path.join("dropbox", safeSeg(req.query.room, "misc"), ym);
  }
  return path.join("posts", ym); // default: Posts feed
}

// ── Tier-0 content guard: only real images/videos get in ─────────────────────
// Sniff the first bytes of the saved file and confirm it's an image or video
// (magic bytes, not just the client-supplied name/MIME, which are trivially
// spoofable). Anything else — PDFs, archives, scripts, disguised executables —
// is rejected and the temp file deleted before it can be served or land in the
// feed. This is the dependable floor; the on-device Apple nudity/text checks
// (docs/content-moderation.md) layer on top for what the bytes can't tell us.
function sniffMediaKind(filePath) {
  let buf;
  try {
    const fd = fs.openSync(filePath, "r");
    buf = Buffer.alloc(32);
    fs.readSync(fd, buf, 0, 32, 0);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  const ascii = (start, len) => buf.toString("latin1", start, start + len);
  // Images
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image"; // JPEG
  if (buf[0] === 0x89 && ascii(1, 3) === "PNG") return "image"; // PNG
  if (ascii(0, 3) === "GIF") return "image"; // GIF
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image"; // BMP
  if (ascii(0, 4) === "RIFF") return ascii(8, 4) === "WEBP" ? "image" : ascii(8, 4) === "AVI " ? "video" : null;
  // ISO base-media boxes ('ftyp' at offset 4): HEIC/HEIF photos + MP4/MOV/3GP video.
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4).toLowerCase();
    if (["heic", "heix", "heif", "hevx", "mif1", "msf1"].includes(brand)) return "image";
    return "video"; // mp4, m4v, mov(qt), 3gp, …
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video"; // Matroska/WebM (EBML)
  if (ascii(0, 3) === "FLV") return "video"; // FLV
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        // Pick the volume BEFORE any bytes land — see pickUploadRoot in
        // media-tiers.js. A big video goes straight to the external drive
        // instead of being written to the SSD and moved (which would mean
        // copying the largest files in the system twice).
        const hotUsage = usageFor(tiers.HOT_DIR);
        const choice = tiers.pickUploadRoot(
          Number(req.headers["content-length"]) || 0,
          hotUsage ? hotUsage.totalBytes : null
        );
        if (!choice.root) {
          req.storageFull = choice.reason; // surfaced as a 507 by /upload
          return cb(new Error(`Not enough storage: ${choice.reason}.`), "");
        }
        if (choice.tier === "cold") console.log(`[upload] routing to the external drive — ${choice.reason}`);
        const dir = path.join(choice.root, uploadSubdir(req));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e, "");
      }
    },
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

// Only signed-in family members can upload — validate the Supabase token by
// asking the cloud project who it belongs to. (No secrets needed here; the
// publishable key + the user's own token are enough.)
async function requireUser(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m || !SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(401).json({ error: "Sign in required." });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
    });
    if (!r.ok) { console.warn(`[auth] token rejected by Supabase: ${r.status}`); return res.status(401).json({ error: "Invalid or expired session." }); }
    next();
  } catch (e) {
    console.error(`[auth] could not reach Supabase: ${e && e.message}`);
    return res.status(503).json({ error: "Couldn't reach the auth service." });
  }
}

// Service-role Supabase client — bypasses RLS and reaches the GoTrue admin API
// (create user, change another user's email). Powerful, so it's used ONLY by the
// admin endpoints below. Null (→ 503) when the key isn't configured. Same key
// the alert mailer uses.
let _admin = null;
function adminClient() {
  if (!SERVICE_KEY || !SUPABASE_URL) return null;
  if (!_admin) {
    const { createClient } = require("@supabase/supabase-js");
    _admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _admin;
}

// Same SMTP setup as alert-mailer.js (reuses the same env vars — no new
// config needed on the mini). Built lazily here too since this module doesn't
// import that one (each mailer-touching module builds its own client, same as
// the service-role Supabase client above).
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || process.env.GMAIL_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "";
const USE_GMAIL = !SMTP_HOST && Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const ALERT_FROM = process.env.ALERT_FROM || (SMTP_USER ? `Muskellunge Lake Resort <${SMTP_USER}>` : "");
const APP_URL = (process.env.APP_URL || "https://mlr-app-omega.vercel.app").replace(/\/+$/, "");

let _mailer = null;
function mailTransport() {
  if (!SMTP_USER || !SMTP_PASS || (!SMTP_HOST && !USE_GMAIL)) return null;
  if (!_mailer) {
    const nodemailer = require("nodemailer");
    _mailer = USE_GMAIL
      ? nodemailer.createTransport({ service: "gmail", auth: { user: SMTP_USER, pass: SMTP_PASS } })
      : nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  }
  return _mailer;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Feature highlights shown in the invite email — kept as data so the HTML and
// plain-text versions render the exact same list from one source.
const INVITE_FEATURES = [
  ["📣", "Get notified the moment there's family news or an announcement"],
  ["👥", "Join a committee — Resort Maintenance, Beautification, Family Fest, and more"],
  ["🙋", "Ask for a hand around the resort, or offer one yourself"],
  ["🎪", "See the full Family Fest schedule and what's planned each day"],
  ["🧭", "See who's Up North and when for any event"],
  ["🗳️", "Vote in family polls — merch designs, meal picks, and more"],
  ["👕", "Order Family Fest t-shirts and other merch"],
  ["📍", "Find local places to eat, shop, play, and book tee times"],
  ["📇", "Look up everyone's phone number and email, all in one directory"],
  ["✉️", "Send bulk emails to the whole family, specific committees, or any group you pick"],
  ["💸", "Pay someone in the family back in a tap — Venmo, Zelle, and more"],
];

// The branded "you're invited" email — the one obvious button signs the
// recipient straight in (the actionLink is a real, already-authenticated
// Supabase auth URL; see /admin/invite-link below), no code to type.
function inviteEmailHtml(name, actionLink) {
  const hi = name ? `Hi ${escapeHtml(name)}, ` : "Hi there, ";
  const featureRows = INVITE_FEATURES.map(
    ([emoji, text]) =>
      `<tr><td style="padding:5px 10px 5px 0;font-size:16px;vertical-align:top;white-space:nowrap">${emoji}</td><td style="padding:5px 0;font-size:14px;vertical-align:top">${escapeHtml(text)}</td></tr>`,
  ).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="text-align:center;margin:0 0 18px"><img src="${APP_URL}/brand-logo-green.png" alt="Muskellunge Lake Resort" width="110" style="display:block;margin:0 auto;max-width:110px;height:auto"></p>
<p style="font-size:22px;margin:0 0 2px"><strong>The new MLR App is here! 🌲</strong></p>
<p style="margin:0 0 18px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 12px;font-size:15px">${hi}you're invited to the family's new home base — one place for
everything happening at the resort, so nothing gets lost in a group text or an old email chain.</p>
<p style="margin:16px 0 10px;font-size:14px;font-weight:600;color:#15503a">Here's what you can do:</p>
<table style="border-collapse:collapse;margin:0 0 8px">${featureRows}</table>
<p style="margin:12px 0 0;font-size:14px;color:#555">...and more being added all the time.</p>
<p style="margin:14px 0 0;font-size:14px;color:#555">📱 <strong>Bonus:</strong> an official iOS app is coming soon for iPhone users!</p>
<p style="margin:22px 0 8px"><a href="${actionLink}" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-size:16px;font-weight:600">Open MLR &amp; get started →</a></p>
<p style="margin:0;text-align:center;font-size:12px;color:#888">🔒 This is your own private invite link — forwarding it to someone else, or another email address, won't work for them.</p>
<p style="margin:14px 0 0;padding:12px 14px;background:#f6f6f1;border-radius:10px;font-size:13px;color:#555"><strong>Tip:</strong> once you're in, add MLR to your phone's Home Screen so it's
a tap away next time. If you do, you'll be asked to sign in there once more —
that's normal, just a one-time thing.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">Muskellunge Lake Resort · Muskellunge Lake, 5 mi from Tomahawk on Hwy 8, Tomahawk, WI</p>
</div>`;
}
function inviteEmailText(name, actionLink) {
  const hi = name ? `Hi ${name}, ` : "Hi there, ";
  const featureLines = INVITE_FEATURES.map(([emoji, text]) => `  ${emoji} ${text}`).join("\n");
  return `The new MLR App is here!\nMuskellunge Lake Resort\n\n${hi}you're invited to the family's new home base — one place for everything happening at the resort, so nothing gets lost in a group text or an old email chain.\n\nHere's what you can do:\n${featureLines}\n  ...and more being added all the time.\n\n📱 Bonus: an official iOS app is coming soon for iPhone users!\n\nOpen MLR & get started: ${actionLink}\n\nThis is your own private invite link — forwarding it to someone else, or another email address, won't work for them.\n\nTip: once you're in, add MLR to your phone's Home Screen so it's a tap away next time. If you do, you'll be asked to sign in there once more — that's normal, just a one-time thing.\n\n— Muskellunge Lake Resort`;
}

// Like requireUser, but also confirms the caller is an admin (profiles.is_admin,
// the single source of truth) using the service-role client. Sets req.adminId.
async function requireAdmin(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m || !SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(401).json({ error: "Sign in required." });
  const sb = adminClient();
  if (!sb) return res.status(503).json({ error: "Admin actions aren't configured on the server." });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
    });
    if (!r.ok) { console.warn(`[admin] token rejected by Supabase: ${r.status}`); return res.status(401).json({ error: "Invalid or expired session." }); }
    const user = await r.json();
    const { data, error } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
    if (error || !data || !data.is_admin) return res.status(403).json({ error: "Admins only." });
    req.adminId = user.id;
    next();
  } catch (e) {
    console.error(`[admin] auth check failed: ${e && e.message}`);
    return res.status(503).json({ error: "Couldn't reach the auth service." });
  }
}

// Admin: invite a member. Pre-creates a named account (so they show in Members
// straight away) and emails the standard one-time CODE — never a magic link, so
// it works inside the installed PWA. Idempotent if the email already exists.
app.post("/admin/invite", express.json(), requireAdmin, async (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const name = String((req.body && req.body.name) || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "A valid email is required." });
  const sb = adminClient();
  try {
    // Create the account; seed display_name so the signup trigger fills the
    // profile. Tolerate "already registered" so re-inviting just re-sends a code.
    const { error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: name ? { display_name: name } : {},
    });
    if (createErr && !/already|registered|exists/i.test(createErr.message || "")) throw createErr;

    const { error: otpErr } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (otpErr) throw otpErr;
    res.json({ ok: true });
  } catch (e) {
    console.error(`[admin/invite] ${e && e.message}`);
    res.status(400).json({ error: (e && e.message) || "Couldn't send the invite." });
  }
});

// Admin: set a member's email FOR them (the "I can't do it myself" backup). Only
// allowed while the two-admin override window is open — re-checked here against
// the database (is_override_unlocked), so the UI gate alone can't authorize it.
app.post("/admin/set-email", express.json(), requireAdmin, async (req, res) => {
  const userId = String((req.body && req.body.userId) || "").trim();
  const newEmail = String((req.body && req.body.newEmail) || "").trim().toLowerCase();
  if (!userId || !/^\S+@\S+\.\S+$/.test(newEmail)) return res.status(400).json({ error: "A user and a valid email are required." });
  const sb = adminClient();
  try {
    const { data: unlocked, error: lockErr } = await sb.rpc("is_override_unlocked");
    if (lockErr) throw lockErr;
    if (!unlocked) return res.status(403).json({ error: "Admin email editing is locked. Two admins must unlock it first." });

    const { error } = await sb.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error(`[admin/set-email] ${e && e.message}`);
    res.status(400).json({ error: (e && e.message) || "Couldn't update the email." });
  }
});

// Admin: invite one or more people by email with a fully custom-branded HTML
// email whose button signs them straight in — no code to type, since the
// admin already knows the email is theirs. Deliberately separate from
// /admin/invite above (which intentionally sends a one-time CODE, not a link,
// so it keeps working inside the installed PWA): this one is for a brand-new
// member's first-ever invite, where there's no installed PWA session yet to
// collide with. Uses auth.admin.generateLink (never Supabase's own "Invite
// user" template/mailer — this project's templates all send a code, see
// supabase/README.md) so we fully own the email's design and copy.
app.post("/admin/invite-link", express.json(), inviteLimiter, requireAdmin, async (req, res) => {
  const entries = Array.isArray(req.body && req.body.entries) ? req.body.entries : [];
  if (!entries.length) return res.status(400).json({ error: "At least one email is required." });
  const transport = mailTransport();
  if (!transport) return res.status(503).json({ error: "Email isn't configured on the server yet." });
  const sb = adminClient();

  const results = [];
  for (const raw of entries) {
    const email = String((raw && raw.email) || "").trim().toLowerCase();
    const name = String((raw && raw.name) || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      results.push({ email: email || "(blank)", ok: false, error: "Not a valid email address." });
      continue;
    }
    try {
      const redirectTo = `${APP_URL}/`;
      // Tag the account so notif_on_new_member() (migration 0085) and the
      // mini's push senders skip the "new member joined" alert for it — the
      // admin sending a batch of these already knows exactly who's coming.
      let { data, error } = await sb.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo, data: { ...(name ? { display_name: name } : {}), invited_via: "invite_link" } },
      });
      if (error && /already|registered|exists/i.test(error.message || "")) {
        ({ data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo } }));
      }
      if (error) throw error;
      const actionLink = data && data.properties && data.properties.action_link;
      if (!actionLink) throw new Error("No link was generated.");

      await transport.sendMail({
        from: ALERT_FROM,
        to: email,
        subject: "🌲 The new MLR App is here — you're invited!",
        text: inviteEmailText(name, actionLink),
        html: inviteEmailHtml(name, actionLink),
      });
      results.push({ email, ok: true });
    } catch (e) {
      console.error(`[admin/invite-link] ${email}: ${e && e.message}`);
      results.push({ email, ok: false, error: (e && e.message) || "Couldn't send the invite." });
    }
  }
  res.json({ results });
});

// Owner-only: restarting this very process is a step above ordinary admin
// actions (it's an infrastructure control, not app content), so it's gated
// to exactly one account by verified email rather than the broader
// profiles.is_admin flag every app admin has. Mirrors lib/owner.ts on the
// client (which only decides whether to SHOW the button — this is the real
// gate). No profiles lookup needed: GoTrue's own /auth/v1/user response
// already carries the verified email.
const OWNER_EMAIL = "brian.theis15@gmail.com";
async function requireOwner(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m || !SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(401).json({ error: "Sign in required." });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
    });
    if (!r.ok) { console.warn(`[owner] token rejected by Supabase: ${r.status}`); return res.status(401).json({ error: "Invalid or expired session." }); }
    const user = await r.json();
    if (String(user.email || "").trim().toLowerCase() !== OWNER_EMAIL) return res.status(403).json({ error: "Not available." });
    req.ownerId = user.id;
    next();
  } catch (e) {
    console.error(`[owner] auth check failed: ${e && e.message}`);
    return res.status(503).json({ error: "Couldn't reach the auth service." });
  }
}

// Report + trigger the "pull latest + restart" cycle that otherwise needs
// someone on the mini itself. REPO_DIR is the mlr-app checkout that contains
// this folder; launchd's KeepAlive relaunches node within ThrottleInterval
// (10s) on any exit, so a plain process.exit(0) is the restart — no
// launchctl call needed.
const REPO_DIR = path.join(__dirname, "..");
function git(args) {
  return execFileSync("git", args, { cwd: REPO_DIR, stdio: "pipe", encoding: "utf8" }).trim();
}

// Free/used space on one volume. Its own try/catch: a statfs hiccup must not
// blank out the git status the page primarily relies on.
function diskInfoFor(dir) {
  if (!dir) return null;
  try {
    const s = fs.statfsSync(dir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize; // bavail = blocks free to a non-root user
    return {
      path: dir,
      external: dir.startsWith("/Volumes/"),
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - free,
    };
  } catch {
    return null;
  }
}

// Both volumes, for the two storage meters on the admin card. `hot` is the SSD
// that serves every read; `cold` is the external backup mirror and is null when
// it isn't configured or isn't currently mounted (the card renders a warning
// rather than a meter in that case). `usage` numbers come from the cached async
// walk in media-usage.js — deliberately NOT computed on this request, see the
// header comment there.
function storageInfo() {
  const coldUp = tiers.coldReady();
  return {
    hot: {
      role: "primary",
      label: "Mac mini SSD",
      disk: diskInfoFor(MEDIA_DIR),
      usage: usageFor(MEDIA_DIR),
    },
    cold: !COLD_DIR
      ? null
      : {
          role: "backup",
          label: "External drive",
          configured: true,
          mounted: coldUp,
          disk: coldUp ? diskInfoFor(COLD_DIR) : null,
          usage: coldUp ? usageFor(COLD_DIR) : null,
        },
  };
}


// Owner-only: dismiss a "needs review" item once it's been dealt with. The photo
// itself is approved/removed through the normal album UI (it was never hidden);
// this just clears it off the review list so the card stops showing it.
app.post("/admin/moderation-reviewed", express.json(), requireOwner, (req, res) => {
  const url = String((req.body && req.body.url) || "").trim();
  if (!url) return res.status(400).json({ error: "Missing url." });
  const cleared = clearGaveUp(url);
  res.json({ ok: true, cleared });
});

// Owner-only: actually DELETE a "needs review" item, right from this card. The
// review list previously only offered "View" (opens the raw file with no path
// back to the post/album it lives in) + "Done" (clears the list entry without
// touching the photo) — so removing something genuinely inappropriate meant
// hunting through the app by hand to find where it was posted. This removes its
// *_media row (service-role, so it works regardless of who uploaded it or which
// feature owns the table) across every table that keys media by this url, then
// deletes the file + its thumbnail off disk, then clears the review entry.
async function deleteMediaRowByUrl(url) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  for (const table of MEDIA_URL_TABLES) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?storage_path=eq.${encodeURIComponent(url)}`,
        {
          method: "DELETE",
          headers: {
            apikey: SERVICE_KEY,
            authorization: `Bearer ${SERVICE_KEY}`,
            prefer: "return=representation",
          },
        },
      );
      if (!resp.ok) {
        console.error(`[admin] moderation-delete: ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        continue;
      }
      const rows = await resp.json().catch(() => []);
      if (Array.isArray(rows) && rows.length > 0) return table;
    } catch (e) {
      console.error(`[admin] moderation-delete: ${table} lookup failed: ${e.message}`);
    }
  }
  return null; // no *_media row referenced this url (already removed, or never had one)
}

app.post("/admin/moderation-delete", express.json(), requireOwner, async (req, res) => {
  const url = String((req.body && req.body.url) || "").trim();
  const relPath = String((req.body && req.body.relPath) || "").trim();
  if (!url) return res.status(400).json({ error: "Missing url." });

  let removedFrom = null;
  try {
    removedFrom = await deleteMediaRowByUrl(url);
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || "Couldn't delete the media record." });
  }

  if (relPath) {
    // Delete from EVERY volume, not just the SSD. This is the one path where
    // "remove this content" has to mean everywhere: the backup mirror is a real
    // read root (see the /f chain), so unlinking only the hot copy would leave
    // the file being served straight off the external drive. deleteFileEverywhere
    // re-applies the traversal guard against each root before touching anything.
    const clean = path.normalize(relPath).replace(/^[/\\]+/, "");
    const removedCopies = deleteFileEverywhere(clean);
    const thumbRel = tiers.relFromAbs(thumbPathFor(path.join(MEDIA_DIR, clean)));
    if (thumbRel) deleteFileEverywhere(thumbRel);
    console.log(`[moderation] deleted ${clean} from ${removedCopies} volume(s)`);
  }

  const cleared = clearGaveUp(url);
  res.json({ ok: true, removedFrom, cleared });
});

app.get("/admin/media-server-status", requireOwner, async (_req, res) => {
  try {
    git(["fetch", "origin", "main"]);
    const local = git(["rev-parse", "HEAD"]);
    const remote = git(["rev-parse", "origin/main"]);
    const behind = Number(git(["rev-list", "--count", `${local}..${remote}`]));
    // `disk`/`usage` stay at the top level for the HOT volume so an older app
    // build (which knows nothing about tiers) keeps rendering its single meter;
    // `storage` is the new two-volume shape the current card reads.
    const storage = storageInfo();
    let patches = null;
    try {
      patches = JSON.parse(fs.readFileSync(path.join(__dirname, "logs", "patch-status.json"), "utf8"));
    } catch {
      /* not scanned yet — the card just omits the section */
    }
    let quarantine = null;
    try {
      quarantine = await trashSummary();
    } catch {
      /* informational only — never sink the status the page relies on */
    }
    res.json({
      ok: true,
      commit: local.slice(0, 7),
      upToDate: local === remote,
      behind,
      startedAt: SERVER_STARTED_AT,
      disk: storage.hot.disk,
      usage: storage.hot.usage,
      storage,
      quarantine,
      patches,
      moderation: { ...moderationStats(), models: moderationStatus() },
    });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || "Couldn't check git status." });
  }
});

app.post("/admin/restart-media-server", requireOwner, async (req, res) => {
  let before, after, changedFiles = [];
  try {
    before = git(["rev-parse", "HEAD"]);
    git(["fetch", "origin", "main"]);
    git(["merge", "--ff-only", "origin/main"]);
    after = git(["rev-parse", "HEAD"]);
    if (before !== after) changedFiles = git(["diff", "--name-only", before, after]).split("\n").filter(Boolean);
  } catch (e) {
    console.error(`[admin] restart-media-server: git update failed: ${e && e.message}`);
    return res.status(409).json({ error: "Couldn't fast-forward to origin/main — the mini's checkout may have diverged. It needs a manual look." });
  }

  const depsChanged = changedFiles.includes("media-server/package.json") || changedFiles.includes("media-server/package-lock.json");
  if (depsChanged) {
    try {
      execFileSync("npm", ["install", "--omit=dev"], { cwd: __dirname, stdio: "pipe", encoding: "utf8" });
    } catch (e) {
      console.error(`[admin] restart-media-server: npm install failed: ${e && e.message}`);
      return res.status(500).json({ error: "Pulled new code but `npm install` failed — fix that on the mini before restarting." });
    }
  }

  console.log(`[owner] restart-media-server: ${req.ownerId} pulled ${before.slice(0, 7)} -> ${after.slice(0, 7)} (${changedFiles.length} files changed), restarting now`);
  res.json({ ok: true, updated: before !== after, from: before.slice(0, 7), to: after.slice(0, 7), filesChanged: changedFiles.length });
  // Give the response a moment to flush before this process exits.
  setTimeout(() => process.exit(0), 300);
});

// Tier-2 AI moderation toggle (default on). Set MOD_ENABLED=0 to disable.
const MOD_ENABLED = process.env.MOD_ENABLED !== "0" && process.env.MOD_ENABLED !== "false";

// Record an AI moderation verdict for a flagged upload, keyed by its public URL
// (the value the app stores as *_media.storage_path). Service-role write; the
// hold triggers (0043 posts, 0128 chat/comments/work, 0171 drop boxes) read it
// on the media row's insert (or retroactively, on UPDATE) to hold the parent
// for admin review.
// Tell the OWNER (and only the owner) that a photo needs a human look. Uses the
// existing `admin_test` notification kind, which both mini senders treat as an
// override push (it reaches anyone whose phone push is on at all, regardless of
// their per-category picks) — so no new PushType, no migration, and the alert
// actually lands. The photo stays VISIBLE in the album; this is what makes that
// acceptable, since the exposure window is "until Brian taps the push", not
// "until someone happens to notice".
async function notifyOwnerNeedsReview(count) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    const pr = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id&contact_email=eq.${encodeURIComponent(OWNER_EMAIL)}&limit=1`,
      { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const rows = pr.ok ? await pr.json() : [];
    const ownerId = rows && rows[0] && rows[0].id;
    if (!ownerId) return; // owner has no account row yet — nothing to notify
    const n = Number(count) || 1;
    await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        user_id: ownerId,
        type: "admin_test",
        title: n === 1 ? "1 photo needs your review" : `${n} photos need your review`,
        body: "The safety check couldn't read them, so they're still visible. Tap to approve or remove.",
        url: "/admin/system",
      }),
    });
  } catch (e) {
    console.warn(`[moderate] owner review notify failed: ${e.message}`);
  }
}

async function recordMediaModeration(fileUrl, v) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/media_moderation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ storage_path: fileUrl, flagged: true, category: v.category, reason: v.reason, model: v.model }),
    });
    if (!resp.ok) console.error(`[moderate] record HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  } catch (e) {
    console.error(`[moderate] record failed: ${e.message}`);
  }
}

// Every table that stores a *_media row keyed by a mini URL in `storage_path`.
// Used by the background-transcode swap below — when a video's on-disk
// filename/extension changes (a .mov upload becomes .mp4), any row that
// already stored the ORIGINAL url needs to be repointed at the new one.
const MEDIA_URL_TABLES = [
  "post_media",
  "post_comment_media",
  "work_item_media",
  "drop_box_media",
  "committee_message_media",
  "house_message_media",
];

// Best-effort: repoint every *_media row's storage_path from the original
// upload url to the transcoded file's url, across every table that might hold
// it (a given url only ever lives in one, but we don't track which at upload
// time). Runs AFTER the transcoded file is safely in place; the original file
// is only deleted once this returns, so a row can never point at a deleted
// file. Never throws — a missed swap just leaves the (still-valid, still
// playable) original in place, same as any fail-open path here.
async function swapMediaStoragePath(oldUrl, newUrl) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  await Promise.all(
    MEDIA_URL_TABLES.map(async (table) => {
      try {
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/${table}?storage_path=eq.${encodeURIComponent(oldUrl)}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              apikey: SERVICE_KEY,
              authorization: `Bearer ${SERVICE_KEY}`,
              prefer: "return=minimal",
            },
            body: JSON.stringify({ storage_path: newUrl }),
          },
        );
        if (!resp.ok) console.error(`[transcode] swap ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      } catch (e) {
        console.error(`[transcode] swap ${table} failed: ${e.message}`);
      }
    }),
  );
}

// Transcode a just-uploaded video in the BACKGROUND, after the upload response
// has already gone out carrying the ORIGINAL file's url. Mirrors the same
// optimistic shape as chat's media moderation (0128): don't make the uploader
// wait on work that can happen just as well a few seconds/minutes later.
//   • Same extension (already uuid.mp4): the original is renamed to uuid_orig.mp4
//     and the rendition takes its place atomically — the url never changes.
//   • Different extension (.mov → .mp4): the original stays at its own url, fully
//     playable, until BOTH the transcode finishes AND every *_media row has been
//     repointed at the new url — only THEN is it renamed aside. So a viewer never
//     sees a broken link; they just get the original for the short window until
//     the swap lands.
// In both cases the original file SURVIVES (as uuid_orig.<ext>) and is what
// `?dl=1` hands back — see the download route.
// Build the adaptive ladder after the progressive rendition is final, so the
// ladder is derived from the bitrate-capped file rather than the raw upload (the
// top rung is meant to match the progressive quality, not exceed it).
//
// Off unless HLS_ENABLED=on: a ladder roughly doubles a video's storage and is
// useless until the client can play it, so generation waits for the player.
function buildLadderInBackground(servedPath) {
  if (!HLS_ENABLED) return;
  buildLadder(servedPath)
    .then((r) => {
      if (r.built) {
        console.log(
          `[hls] ${path.basename(servedPath)} -> ${r.rungs.join("/")}, ` +
            `${r.segments} segments, ${(r.bytes / 1048576).toFixed(1)} MB`
        );
      } else if (r.reason && r.reason !== "ladder already exists") {
        console.log(`[hls] ${path.basename(servedPath)}: ${r.reason}`);
      }
    })
    .catch((e) => console.error(`[hls] failed for ${path.basename(servedPath)}: ${e && e.message}`));
}

function transcodeInBackground(originalPath, mimetype, originalUrl) {
  maybeTranscode(originalPath, mimetype, { keepOriginalUrl: true })
    .then(async (r) => {
      if (!r.transcoded) {
        if (r.reason) console.log(`[transcode] (async) no rendition needed (${r.reason})`);
        // Already streamable as a single file, but it can still benefit from an
        // adaptive ladder for viewers on weak connections.
        buildLadderInBackground(r.path);
        return;
      }
      if (!r.pathChanged) {
        console.log(
          `[transcode] (async) ${path.basename(r.path)} rendition built; original kept as ${path.basename(r.originalPath)}`
        );
        buildLadderInBackground(r.path);
        return;
      }
      // relFromAbs, not path.relative(MEDIA_DIR, …): the transcode writes beside
      // the original, which for an aged-off file can be on the external drive.
      const rel = tiers.relFromAbs(r.path);
      if (!rel) {
        console.error(`[transcode] (async) transcoded file landed outside every media root: ${r.path}`);
        return;
      }
      const newUrl = `${PUBLIC_URL}/f/${rel}`;
      console.log(`[transcode] (async) ${path.basename(originalPath)} → ${path.basename(r.path)}, repointing references`);
      await swapMediaStoragePath(originalUrl, newUrl);
      // References now point at the rendition, so the original can finally be
      // moved aside — RENAMED to _orig, never deleted. Losing the full-quality
      // file here is exactly the behaviour this replaced.
      const kept = r.finishSwap ? r.finishSwap() : null;
      console.log(
        kept
          ? `[transcode] (async) original preserved as ${path.basename(kept)}`
          : `[transcode] (async) ⚠ could not preserve the original for ${path.basename(originalPath)}`
      );
      buildLadderInBackground(r.path);
    })
    .catch((e) => console.error(`[transcode] async error, original file kept as-is: ${e && e.message}`));
}

// Upload one file. Folder comes from ?category=posts|chat (&room=<slug> for
// chat); the returned URL points at wherever it was filed. The app stores that
// URL as-is, so the layout is an implementation detail callers don't track.
app.post("/upload", requireUser, (req, res) => {
  // The actual multipart transfer is the only thing this timeout needs to cover
  // now — transcode and moderation both moved to the background (below), so
  // this no longer has to wait out a multi-minute ffmpeg run.
  //
  // ⚠️ THIS, not MAX_MB, is the real ceiling on upload size. Raising the file cap
  // without raising this just converts a clean 413 ("too big") into a timeout
  // partway through a long upload — a much worse failure for whoever is sending
  // the big fest video, since it wastes the whole transfer and reports nothing
  // useful. Keep the two in step with MAX_MB: at 50 GB the honest limit is
  // bandwidth, so this is hours, not minutes — a big video uploaded from the LAN
  // needs the socket held open the whole time. A stalled connection is still
  // eventually reaped rather than held forever.
  req.setTimeout(Number(process.env.UPLOAD_TIMEOUT_MS || 4 * 60 * 60 * 1000));

  // A CLIENT-ABORTED upload (dropped Wi-Fi, app backgrounded, tunnel cut) does
  // not reach multer's error callback, so its half-written file used to sit on
  // disk until the orphan sweep noticed 48h later. At these sizes that's GBs of
  // dead weight — a real 256MB video upload died at 54% and left a 139MB
  // fragment. Reclaim it as soon as the socket closes without a response.
  req.on("aborted", () => {
    const p = req.file && req.file.path;
    if (!p) return; // nothing written yet, or already handled below
    fs.unlink(p, (e) => {
      if (!e) console.log(`[upload] client aborted — removed the partial file ${path.basename(p)}`);
    });
  });

  upload.single("file")(req, res, async (err) => {
    if (err) {
      // Out of room on BOTH volumes is not the client's fault — 507 tells the
      // app to say "the server is out of space" instead of blaming the file.
      if (req.storageFull) {
        console.error(`[upload] refused: ${req.storageFull}`);
        return res.status(507).json({ error: "The media server is out of storage space. Ask an admin to free some up." });
      }
      // A file that blew the cap (or a yanked connection) leaves a partial file
      // behind; at these sizes that can be many GB, so clean it up.
      if (req.file && req.file.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      console.error(`[upload] error: ${err.message}`);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) { console.error(`[upload] no file in request`); return res.status(400).json({ error: "No file received." }); }

    // Tier-0 guard: sniff the bytes. Posts/work uploads stay images/videos only.
    // CHAT allows any file (PDFs, docs, etc. — iMessage-style), so a sniff miss
    // there means "generic file", not a rejection.
    const kind = sniffMediaKind(req.file.path);
    const category = safeSeg(req.query.category, "posts");
    const isMedia = kind === "image" || kind === "video";
    if (!isMedia && category !== "chat") {
      try { fs.unlinkSync(req.file.path); } catch {}
      console.warn(`[upload] rejected non-media file ${req.file.originalname} (${req.file.mimetype})`);
      return res.status(415).json({ error: "Only photos and videos can be uploaded." });
    }
    // What the client stores as media_type: 'image' | 'video' | 'file'.
    const mediaType = isMedia ? kind : "file";

    // PHOTOS: build the browser-facing display copy now, keeping the untouched
    // upload beside it as `<uuid>_orig.<ext>`. This runs INLINE rather than in the
    // background (unlike video) for two reasons: it's fast — a sharp resize is
    // well under a second, versus a multi-minute ffmpeg run — and the url must be
    // final before we respond, since a HEIC upload's url has to become .jpg or no
    // browser can render it at all. Never fatal: on any failure the original is
    // served as-is, which is worse for bandwidth but perfectly correct.
    let served = req.file.path;
    if (kind === "image") {
      try {
        const d = await makeDisplayCopy(served);
        if (d.changed) {
          console.log(
            `[display] ${path.basename(served)} (${d.from}) -> ${path.basename(d.path)}; ` +
              `original kept as ${path.basename(d.originalPath)}`
          );
          served = d.path;
        } else if (d.reason) {
          console.log(`[display] ${path.basename(served)}: ${d.reason}`);
        }
      } catch (e) {
        console.error(`[display] failed, serving the original as-is: ${e && e.message}`);
      }
    }

    // Videos are NOT transcoded inline (see transcodeInBackground below), so they
    // return effectively instantly and the smaller rendition lands a little later
    // at either the same url or a repointed one — see its doc comment.
    const rel = tiers.relFromAbs(served);
    const fileUrl = `${PUBLIC_URL}/f/${rel}`;
    let size = req.file.size;
    try { size = fs.statSync(served).size; } catch {}
    console.log(`[upload] saved ${rel} (${size} bytes)`);

    if (kind === "video") transcodeInBackground(served, req.file.mimetype, fileUrl);

    // "When was this actually taken" for Drop Box album sorting (0174).
    // ⚠️ This got much more reliable: the browser no longer re-encodes photos
    // through a <canvas> (which destroyed all EXIF), so the ORIGINAL now reaches
    // this server intact and extractCapturedAt can read real DateTimeOriginal off
    // it — including HEIC, via sharp. The client still sends its own reading as a
    // form field, which is now a fallback rather than the only chance. For a video (never recompressed
    // client-side), ffprobe reads the container's own creation_time here,
    // before the background transcode replaces the file. Never fatal — null
    // just means "no captured date," and the album falls back to upload time.
    let capturedAt = null;
    let capturedAtSource = null;
    if (isMedia) {
      const clientCapturedAt = typeof req.body?.capturedAt === "string" ? req.body.capturedAt.trim() : "";
      const claimed = typeof req.body?.capturedAtSource === "string" ? req.body.capturedAtSource.trim() : "";
      if (clientCapturedAt) {
        const d = new Date(clientCapturedAt);
        if (!Number.isNaN(d.getTime())) {
          capturedAt = d.toISOString();
          // Trust only the two the client can legitimately produce; anything
          // else (or nothing) is treated as the weaker file-mtime guess.
          capturedAtSource = claimed === "exif" ? "exif" : "file";
        }
      }
      // Read the stored bytes when the client had nothing — or had only the
      // weak file-mtime guess, since real metadata always wins. This is what
      // catches a HEIC (sharp can open it; the client's JPEG parser can't), plus
      // every video.
      //
      // ⚠️ Read the ORIGINAL, not the display copy. The display JPEG carries
      // copied metadata, but the original is the authoritative source and is the
      // only one guaranteed to have untouched EXIF — reading the derivative would
      // quietly reintroduce the class of bug that migrations 0174-0176 exist to
      // undo. findOriginal returns null when there is no separate original (a
      // normal web-sized JPEG served as-is), in which case `served` IS the original.
      if (!capturedAt || capturedAtSource === "file") {
        try {
          const metaSource = findOriginal(served) || served;
          const fromFile = await extractCapturedAt(metaSource, kind);
          if (fromFile) {
            capturedAt = fromFile;
            capturedAtSource = kind === "video" ? "video" : "exif";
          }
        } catch (e) {
          console.warn(`[captured-at] error (non-fatal): ${e && e.message}`);
        }
      }
    }

    // Small preview thumbnail — generated inline (a single fast decode, not the
    // moderation/transcode cost) so the response can hand the client a ready-
    // to-use small url immediately; grids/albums render this instead of the
    // full-res file. Never fatal: null just means "no thumbnail yet", and every
    // renderer falls back to the full-res url.
    let thumbnailUrl = null;
    if (isMedia) {
      try {
        const thumbPath = await makeThumbnail(served, kind);
        if (thumbPath) {
          const thumbRel = tiers.relFromAbs(thumbPath);
          thumbnailUrl = `${PUBLIC_URL}/f/${thumbRel}`;
        }
      } catch (e) {
        console.warn(`[thumb] error (non-fatal): ${e && e.message}`);
      }
    }

    // Tier-2 guard: AI moderation. A flagged image/video → record a verdict
    // keyed by the public URL (== *_media.storage_path) so the hold triggers
    // (0043 posts, 0128 chat/comments/work, 0171 drop boxes) hold the parent
    // for admin review. FAIL-OPEN: any error/unavailability just lets the
    // upload through (member reports + the admin queue are the backstop).
    //
    // EVERY category is OPTIMISTIC now (this used to be chat-only): respond
    // IMMEDIATELY (assume good intent, no send-time latency) and moderate in
    // the BACKGROUND. A flagged verdict is written to media_moderation
    // afterward, and its trigger (0128) RETROACTIVELY holds the already-posted
    // content (RLS then hides it from the feed/room/album within a refetch).
    if (MOD_ENABLED && isMedia) {
      // Fire-and-forget — never blocks the upload response, for any category.
      moderateMedia(served, kind)
        .then((v) => {
          if (v) noteScanned(Boolean(v.flagged)); // owner-visible running total
          // Model refused to analyze it: left VISIBLE (weak signal, see
          // moderation.js) but recorded so it shows up in the owner's
          // For-review list with approve/delete.
          if (v && v.needsReview && noteNeedsReview({ url: fileUrl, relPath: rel, kind, reason: v.reason })) {
            void notifyOwnerNeedsReview(moderationStats().gaveUp.length);
          }
          if (v && v.flagged) {
            console.log(`[moderate] (async) ${rel} → FLAGGED ${v.category} (${v.reason}) via ${v.model}`);
            return recordMediaModeration(fileUrl, v);
          }
          if (v) {
            console.log(`[moderate] (async) ${rel} → ok via ${v.model}`);
          } else {
            // Couldn't check (model unavailable) — queue for re-check so it
            // gets moderated once the model is back (retroactive hold via
            // 0128). Every category re-checks now, including drop boxes: with
            // moderation off the response's critical path, there's no longer a
            // reason to let a fail-open at upload time go unrevisited forever.
            console.log(`[moderate] (async) ${rel} → not checked (fail-open) — queued for re-check`);
            enqueueRecheck({ url: fileUrl, relPath: rel, kind, category });
          }
        })
        .catch((e) => console.error(`[moderate] async error (fail-open): ${e.message}`));
    }
    // `hlsUrl` is where the ladder WILL live. It's advertised even before the
    // background build finishes so the client can store one url and simply fall
    // back to the progressive mp4 until the playlist exists — no second round trip
    // and no database column needed (the path is derived by convention).
    const hlsUrl =
      HLS_ENABLED && kind === "video" ? `${PUBLIC_URL}/f/${tiers.relFromAbs(masterPathFor(served))}` : null;
    res.json({ url: fileUrl, thumbnailUrl, hlsUrl, capturedAt, capturedAtSource, name: path.basename(served), originalName: req.file.originalname, type: mediaType, path: rel });
  });
});

// Tier-2 text moderation: grade a caption/post's text for inappropriate
// language. The app calls this before publishing; flagged → the app creates the
// post as `pending` (held for admin review). FAIL-OPEN: returns {flagged:false}
// on any error/unavailability.
app.post("/moderate/text", moderateTextLimiter, requireUser, express.json({ limit: "64kb" }), async (req, res) => {
  try {
    if (!MOD_ENABLED) return res.json({ flagged: false });
    const v = await moderateText((req.body && req.body.text) || "");
    if (!v) return res.json({ flagged: false });
    res.json({ flagged: !!v.flagged, category: v.category, reason: v.reason });
  } catch (e) {
    console.error(`[moderate/text] ${e.message}`);
    res.json({ flagged: false });
  }
});

// Semantic search across everything this member can see — the resort Feed
// (posts + comments), their committee/area chats, and their house chat — with
// "find it without the exact words" matching. The mini does the AI part (embed
// the query on-device via embed-service) and the FILTERING part happens in
// Postgres: we forward the caller's own Supabase token so the search_conversations
// RPC (migration 0129) runs AS this member and RLS scopes the results to exactly
// what they're allowed to see. This server never bypasses that with the
// service-role key for search — the user's token is the whole point.
app.post("/search", searchLimiter, requireUser, express.json({ limit: "8kb" }), async (req, res) => {
  const q = String((req.body && req.body.q) || "").trim().slice(0, 500);
  const limit = Math.min(Math.max(Number((req.body && req.body.limit) || 20) || 20, 1), 50);
  if (q.length < 2) return res.json({ query: q, count: 0, results: [] });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(503).json({ error: "Search isn't configured." });

  // The caller's token was just validated by requireUser — reuse it so RLS applies.
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const token = m && m[1];
  if (!token) return res.status(401).json({ error: "Sign in required." });

  // 1) Embed the query on the mini (on-device Apple NLContextualEmbedding).
  let vec;
  try {
    vec = await embedOne(q);
  } catch (e) {
    console.error(`[search] embed failed: ${e && e.message}`);
    return res.status(503).json({ error: "Search is warming up. Try again in a moment." });
  }
  if (!vec) return res.json({ query: q, count: 0, results: [] });

  // 2) Run the RLS-scoped similarity search AS this member.
  try {
    const { createClient } = require("@supabase/supabase-js");
    const userSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const vecLit = toVectorLiteral(vec);
    // Hybrid: keyword matches rank first, semantic fills in (migration 0130).
    let { data, error } = await userSb.rpc("search_conversations", {
      query_embedding: vecLit,
      query_text: q,
      match_count: limit,
    });
    // Pre-0130 DB (RPC has no query_text param) → fall back to the semantic-only
    // signature so search keeps working until the migration is applied.
    if (error && (error.code === "PGRST202" || /find the function|schema cache|query_text/i.test(`${error.message || ""} ${error.hint || ""}`))) {
      ({ data, error } = await userSb.rpc("search_conversations", {
        query_embedding: vecLit,
        match_count: limit,
      }));
    }
    if (error) throw error;
    const results = Array.isArray(data) ? data : [];
    res.json({ query: q, count: results.length, results });
  } catch (e) {
    console.error(`[search] rpc failed: ${e && e.message}`);
    res.status(502).json({ error: "Couldn't run the search." });
  }
});

// ⚠️ Bind to LOOPBACK, not 0.0.0.0. Caddy is the only thing that should ever talk
// to this process directly, and it proxies from 127.0.0.1:8790 — so listening on
// every interface bought nothing and cost two things: (1) any device on the house
// WiFi could reach the whole API — /f, /upload, /admin/* — over PLAIN HTTP,
// skipping Caddy's TLS entirely, and (2) if a second port were ever forwarded on
// the eero, the server would be publicly exposed with no TLS and no cert. Now the
// public surface is exactly one port (443 → 9443 → Caddy → here) and nothing else.
// Override with BIND_HOST only for a deliberate reason (e.g. testing from a phone
// on the LAN); leaving it unset is the secure default.
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";
app.listen(PORT, BIND_HOST, () => {
  console.log(`MLR media-server on ${BIND_HOST}:${PORT}`);
  console.log(`  public URL : ${PUBLIC_URL}`);
  console.log(`  media dir  : ${MEDIA_DIR} (primary)`);
  console.log(
    `  backup dir : ${COLD_DIR ? `${COLD_DIR}${tiers.coldReady() ? "" : " ⚠ NOT MOUNTED"}` : "none — media has NO backup"}`
  );
  console.log(`  max file   : ${MAX_MB} MB`);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) console.warn("  ⚠ SUPABASE_URL / SUPABASE_ANON_KEY not set — uploads will be rejected.");
  if (!TRANSCODE_ENABLED) {
    console.log("  video      : transcoding OFF (VIDEO_TRANSCODE=off)");
  } else {
    ffmpegAvailable().then((ok) => {
      if (ok) console.log(`  video      : transcoding ON (H.264 MP4, ≤${MAX_LONG_EDGE}px, crf ${CRF})`);
      else console.warn("  ⚠ video    : ffmpeg/ffprobe not found — videos stored as-is. Install with: brew install ffmpeg");
    });
  }

  // Keep the storage meters warm off the request path (see media-usage.js for
  // why this is not computed inside the status endpoint any more). The dirs are
  // re-evaluated each tick so a drive plugged in later starts being measured.
  startUsageRefresh(() => tiers.mediaRoots());

  // Mirror the SSD to the external drive. Reconciling, so an unplugged drive
  // just means the next pass has more to copy.
  try {
    startMirrorSweep();
  } catch (e) {
    console.error(`[mirror] could not start: ${e && e.message}`);
  }

  // Reconcile disk against the database and quarantine media nothing references
  // any more (deleting a photo in the app only ever removed its row). Holds for
  // 7 days before purging, and aborts rather than guess if anything looks off.
  try {
    startOrphanSweep({ admin: adminClient() });
  } catch (e) {
    console.error(`[orphan] could not start: ${e && e.message}`);
  }
});

// Optional: email opted-in members when a broadcast alert is posted. No-op
// unless the Gmail + service-role env vars are set (see alert-mailer.js).
// Isolated in try/catch so a mailer hiccup can never take down uploads.
try {
  require("./alert-mailer").start().catch((e) => console.error("[mailer] start failed:", e && e.message));
} catch (e) {
  console.error("[mailer] not started:", e && e.message);
}

// Optional: web-push notifications for chat messages + alerts. No-op unless the
// VAPID + service-role env vars are set (see push-sender.js). Also isolated so a
// push hiccup can never take down uploads.
try {
  require("./push-sender").start().catch((e) => console.error("[push] start failed:", e && e.message));
} catch (e) {
  console.error("[push] not started:", e && e.message);
}

// Optional: native iOS push via APNs (see apns-sender.js). No-op unless the
// APNS_* + service-role env vars are set. Isolated like the others.
try {
  require("./apns-sender").start().catch((e) => console.error("[apns] start failed:", e && e.message));
} catch (e) {
  console.error("[apns] not started:", e && e.message);
}

// Optional: daily birthday notifications (see birthday-notifier.js). No-op
// unless the VAPID + service-role env vars are set. Isolated so a hiccup here
// can never take down uploads.
try {
  require("./birthday-notifier").start().catch((e) => console.error("[birthday] start failed:", e && e.message));
} catch (e) {
  console.error("[birthday] not started:", e && e.message);
}

// Optional: Work Checklist "did it get done?" follow-up pushes (see
// work-followup.js). No-op unless the APNS_* + service-role env vars are set.
// Isolated like the others.
try {
  require("./work-followup").start().catch((e) => console.error("[work-followup] start failed:", e && e.message));
} catch (e) {
  console.error("[work-followup] not started:", e && e.message);
}

// Re-moderate anything that failed open (model unavailable at upload) once the
// model is back — so nothing posted during an outage stays unchecked. A flag
// found later retroactively holds the item (media_moderation trigger, 0128).
try {
  startBackfill({ moderateMedia, recordMediaModeration, mediaDir: MEDIA_DIR });
} catch (e) {
  console.error("[recheck] not started:", e && e.message);
}

// Recover "date taken" for album items whose metadata the client couldn't read
// — anything added before the feature shipped, and anything referenced into an
// album from an existing Feed post (no original File left on the client, only a
// URL). The bytes are still here, so EXIF is read straight off disk.
try {
  startCapturedAtBackfill({ admin: adminClient(), publicUrl: PUBLIC_URL, mediaDir: MEDIA_DIR });
} catch (e) {
  console.error("[captured-at] not started:", e && e.message);
}

// Generate the grid/album previews for media uploaded before thumbnails
// existed. Without this every tile downloads the full-res file, and a video
// with no poster frame renders as a black box on iOS.
try {
  startThumbnailBackfill({ admin: adminClient(), publicUrl: PUBLIC_URL, mediaDir: MEDIA_DIR });
} catch (e) {
  console.error("[thumb-backfill] not started:", e && e.message);
}

// Optional: keep the semantic-search index fresh (embeds new/edited posts + chat
// via the on-device embed-service, into content_embeddings). No-op unless the
// service-role key is set; tolerates embed-service being down or the 0129
// migration not having run yet. Isolated so it can never take down uploads.
try {
  startSearchIndexer();
} catch (e) {
  console.error("[search-index] not started:", e && e.message);
}
