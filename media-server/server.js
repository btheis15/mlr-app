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
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const ALLOWED = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_MB = Number(process.env.MAX_MB || 1024); // per-file cap (MB); your disk is the real limit
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, "media");
const LEGACY_DIR = path.join(MEDIA_DIR, "posts", "legacy");

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(LEGACY_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: ALLOWED.length ? ALLOWED : true, methods: ["GET", "POST", "OPTIONS"] }));

// Lightweight request log (method, path, origin, body size, auth present) so
// upload problems are diagnosable from logs/server.log.
app.use((req, _res, next) => {
  if (req.url !== "/health") {
    console.log(`[req] ${new Date().toISOString()} ${req.method} ${req.url} origin=${req.headers.origin || "-"} len=${req.headers["content-length"] || "-"} auth=${req.headers.authorization ? "yes" : "no"}`);
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Public read of media. express.static honours HTTP Range requests, so video
// seeking/streaming works, and sets long-lived caching (filenames are unique).
// 1) the whole organized tree (posts/<ym>/…, chat/<slug>/<ym>/…); 2) a fallback
// on posts/legacy so already-saved flat "/f/<uuid>.<ext>" URLs still resolve;
// 3) a final 404 so misses don't hang.
const staticOpts = { maxAge: "365d", immutable: true };
app.use("/f", express.static(MEDIA_DIR, staticOpts));
app.use("/f", express.static(LEGACY_DIR, staticOpts));
app.use("/f", (_req, res) => res.status(404).json({ error: "Not found." }));

// Small static app assets shipped with the repo (e.g. pay-method logos). Served
// from here so they live on the mini (free) instead of Supabase storage.
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "30d" }));

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
  return path.join("posts", ym); // default: Posts feed
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

// Upload one file. Folder comes from ?category=posts|chat (&room=<slug> for
// chat); the returned URL points at wherever it was filed. The app stores that
// URL as-is, so the layout is an implementation detail callers don't track.
app.post("/upload", requireUser, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) { console.error(`[upload] error: ${err.message}`); return res.status(400).json({ error: err.message }); }
    if (!req.file) { console.error(`[upload] no file in request`); return res.status(400).json({ error: "No file received." }); }
    const rel = path.relative(MEDIA_DIR, req.file.path).split(path.sep).join("/");
    console.log(`[upload] saved ${rel} (${req.file.size} bytes)`);
    res.json({ url: `${PUBLIC_URL}/f/${rel}`, name: req.file.filename, path: rel });
  });
});

app.listen(PORT, () => {
  console.log(`MLR media-server on :${PORT}`);
  console.log(`  public URL : ${PUBLIC_URL}`);
  console.log(`  media dir  : ${MEDIA_DIR}`);
  console.log(`  max file   : ${MAX_MB} MB`);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) console.warn("  ⚠ SUPABASE_URL / SUPABASE_ANON_KEY not set — uploads will be rejected.");
});
