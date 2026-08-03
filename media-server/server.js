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
const path = require("path");
const { execFileSync } = require("child_process");
const { maybeTranscode, ffmpegAvailable, ENABLED: TRANSCODE_ENABLED, MAX_LONG_EDGE, CRF } = require("./transcode");
const { moderateMedia, moderateText } = require("./moderation");
const { enqueueRecheck, startBackfill } = require("./moderation-backfill");
const { makeThumbnail } = require("./thumbnail");
const { extractCapturedAt } = require("./captured-at");
const { startCapturedAtBackfill } = require("./captured-at-backfill");
const { startThumbnailBackfill } = require("./thumbnail-backfill");
const { embedOne, toVectorLiteral } = require("./embed-client");
const { start: startSearchIndexer } = require("./search-indexer");

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
const MAX_MB = Number(process.env.MAX_MB || 256); // per-file cap (MB); your disk is the real limit
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, "media");
const LEGACY_DIR = path.join(MEDIA_DIR, "posts", "legacy");

// If MEDIA_DIR lives on an external volume (/Volumes/<name>/…), make sure that
// volume is actually MOUNTED before we touch it. Otherwise the mkdirSync below
// would happily recreate the path as an empty folder on the internal disk — and
// then every existing photo/video 404s while new uploads silently misfile onto
// the boot drive. Detect it by comparing filesystem device ids: a real mount
// sits on a different device than "/"; a stale/empty dir left at the mountpoint
// (or a missing path) is on the same device as "/". Fail loud and exit — launchd
// (KeepAlive + 10s ThrottleInterval) will retry until the drive is back, rather
// than come up writing to the wrong place. The default ./media (internal, dev)
// is unaffected — the guard only runs for a /Volumes path.
if (MEDIA_DIR.startsWith("/Volumes/")) {
  const volRoot = "/" + MEDIA_DIR.split("/").slice(1, 3).join("/"); // /Volumes/<name>
  let mounted = false;
  try {
    mounted = fs.statSync(volRoot).dev !== fs.statSync("/").dev;
  } catch {
    mounted = false; // volRoot doesn't even exist → not mounted
  }
  if (!mounted) {
    console.error(
      `FATAL: MEDIA_DIR is ${MEDIA_DIR} but the volume ${volRoot} is not mounted. ` +
        `Refusing to start so media isn't misfiled onto the internal disk — plug in / remount the drive.`
    );
    process.exit(1);
  }
}

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(LEGACY_DIR, { recursive: true });

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
  skip: (req) => req.path === "/health", // don't count uptime checks against anyone
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  // uploads/hour/IP. Sized for the REAL core use case: dumping a whole album
  // (a fest is easily 200-500 photos from one phone), and a lake full of family
  // shares one WiFi/IP — behind the tunnel they can collapse to a single key,
  // so 30 (the old value) 429'd a single dump at photo #31. Still a floor
  // against a runaway loop; every upload is auth'd + magic-sniffed + MAX_MB-capped.
  limit: Number(process.env.UPLOAD_LIMIT_PER_HOUR) || 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads from this device recently. Try again in a bit." },
});
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
app.use((req, _res, next) => {
  if (req.url !== "/health") {
    console.log(`[req] ${new Date().toISOString()} ${req.method} ${req.url} origin=${req.headers.origin || "-"} len=${req.headers["content-length"] || "-"} auth=${req.headers.authorization ? "yes" : "no"}`);
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
app.use("/f", (req, res, next) => {
  if (req.query.dl != null) {
    const base = path.basename(req.path) || "download";
    res.setHeader("Content-Disposition", `attachment; filename="${base.replace(/[^\w.\-]/g, "_")}"`);
  }
  next();
});
app.use("/f", express.static(MEDIA_DIR, staticOpts));
app.use("/f", express.static(LEGACY_DIR, staticOpts));
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
  const boxDir = path.join(MEDIA_DIR, "dropbox", box);

  // Build the zip args + cwd. With an explicit file list (the normal path — the
  // client sends every item's media-root-relative path), resolve each under the
  // MEDIA ROOT, not the box folder, so an album can include files stored
  // ANYWHERE in the tree — e.g. a Feed post's photo the user also added to the
  // album lives under posts/, not dropbox/<box>/. Sanitize each against
  // path traversal; `-j` flattens so the zip is one flat set of files.
  // With NO list (fallback) recurse the box's own folder.
  let args;
  let cwd;
  if (relPaths && relPaths.length) {
    const safe = [];
    for (const raw of relPaths) {
      if (typeof raw !== "string" || !raw) continue;
      const clean = path.normalize(raw).replace(/^[/\\]+/, "");
      const abs = path.join(MEDIA_DIR, clean);
      const rel = path.relative(MEDIA_DIR, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue; // escaped the root → skip
      try {
        if (fs.statSync(abs).isFile()) safe.push(rel);
      } catch {
        /* gone — skip */
      }
    }
    if (!safe.length) return res.status(400).json({ error: "No files selected." });
    args = ["-j", "-q", "-", ...safe]; // -j flatten, - = write archive to stdout
    cwd = MEDIA_DIR;
  } else {
    try {
      if (!fs.statSync(boxDir).isDirectory()) throw new Error("not a dir");
    } catch {
      return res.status(404).json({ error: "Nothing to download yet." });
    }
    args = ["-r", "-q", "-", "."];
    cwd = boxDir;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${(name || box)}.zip"`);

  const { spawn } = require("child_process");
  const zip = spawn("zip", args, { cwd });
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
        const dir = path.join(MEDIA_DIR, uploadSubdir(req));
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

// Free/used space on the volume that actually holds MEDIA_DIR — so the owner can
// see the drive filling up right from the app. Its own try/catch: a statfs hiccup
// must not blank out the git status the page primarily relies on.
function mediaDiskInfo() {
  try {
    const s = fs.statfsSync(MEDIA_DIR);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize; // bavail = blocks free to a non-root user
    return {
      path: MEDIA_DIR,
      external: MEDIA_DIR.startsWith("/Volumes/"),
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - free,
    };
  } catch {
    return null;
  }
}

app.get("/admin/media-server-status", requireOwner, async (_req, res) => {
  try {
    git(["fetch", "origin", "main"]);
    const local = git(["rev-parse", "HEAD"]);
    const remote = git(["rev-parse", "origin/main"]);
    const behind = Number(git(["rev-list", "--count", `${local}..${remote}`]));
    res.json({ ok: true, commit: local.slice(0, 7), upToDate: local === remote, behind, startedAt: SERVER_STARTED_AT, disk: mediaDiskInfo() });
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
//   • Same-path swap (already uuid.mp4): maybeTranscode renames it into place
//     atomically — the url never changes, so nothing else is needed.
//   • Different-path swap (extension changes, e.g. .mov → .mp4): the original
//     stays in place and fully playable until BOTH the transcode finishes AND
//     every *_media row referencing the old url has been repointed at the new
//     one — only then is the original deleted. So a viewer never sees a broken
//     link; they just see the original (larger/possibly-HEVC) file for the
//     short window until the swap lands.
function transcodeInBackground(originalPath, mimetype, originalUrl) {
  maybeTranscode(originalPath, mimetype, { deleteOriginal: false })
    .then(async (r) => {
      if (!r.transcoded) {
        if (r.reason) console.log(`[transcode] (async) kept original (${r.reason})`);
        return;
      }
      if (!r.pathChanged) {
        console.log(`[transcode] (async) ${path.basename(originalPath)} re-encoded in place`);
        return;
      }
      const rel = path.relative(MEDIA_DIR, r.path).split(path.sep).join("/");
      const newUrl = `${PUBLIC_URL}/f/${rel}`;
      console.log(`[transcode] (async) ${path.basename(originalPath)} → ${path.basename(r.path)}, repointing references`);
      await swapMediaStoragePath(originalUrl, newUrl);
      try { fs.unlinkSync(originalPath); } catch {}
    })
    .catch((e) => console.error(`[transcode] async error, original file kept as-is: ${e && e.message}`));
}

// Upload one file. Folder comes from ?category=posts|chat (&room=<slug> for
// chat); the returned URL points at wherever it was filed. The app stores that
// URL as-is, so the layout is an implementation detail callers don't track.
app.post("/upload", uploadLimiter, requireUser, (req, res) => {
  // The actual multipart transfer is the only thing this timeout needs to cover
  // now — transcode and moderation both moved to the background (below), so
  // this no longer has to wait out a multi-minute ffmpeg run.
  req.setTimeout(10 * 60 * 1000);
  upload.single("file")(req, res, async (err) => {
    if (err) { console.error(`[upload] error: ${err.message}`); return res.status(400).json({ error: err.message }); }
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

    // The file we RESPOND with is always the just-saved original — videos are
    // no longer transcoded inline (see transcodeInBackground below), so photos
    // and videos alike return effectively instantly. The eventual, smaller
    // ≤1080p H.264 file (when transcoding applies) lands a little later at
    // either the same url (same-path re-encode) or, for an extension change, a
    // repointed one — see transcodeInBackground's doc comment.
    const served = req.file.path;
    const rel = path.relative(MEDIA_DIR, served).split(path.sep).join("/");
    const fileUrl = `${PUBLIC_URL}/f/${rel}`;
    let size = req.file.size;
    try { size = fs.statSync(served).size; } catch {}
    console.log(`[upload] saved ${rel} (${size} bytes)`);

    if (isMedia) transcodeInBackground(served, req.file.mimetype, fileUrl);

    // "When was this actually taken" for Drop Box album sorting (0174). For a
    // photo, the client already extracted EXIF DateTimeOriginal from the
    // ORIGINAL file (before compressing it away, which strips EXIF) and sends
    // it as a plain form field — this server has no way to recover it once
    // the compressed bytes arrive. For a video (never recompressed
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
      // catches a HEIC (sharp can open it; the client's JPEG parser can't) and
      // any photo compressImage decided not to re-encode, plus every video.
      if (!capturedAt || capturedAtSource === "file") {
        try {
          const fromFile = await extractCapturedAt(served, kind);
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
          const thumbRel = path.relative(MEDIA_DIR, thumbPath).split(path.sep).join("/");
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
    res.json({ url: fileUrl, thumbnailUrl, capturedAt, capturedAtSource, name: path.basename(served), originalName: req.file.originalname, type: mediaType, path: rel });
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

app.listen(PORT, () => {
  console.log(`MLR media-server on :${PORT}`);
  console.log(`  public URL : ${PUBLIC_URL}`);
  console.log(`  media dir  : ${MEDIA_DIR}`);
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
