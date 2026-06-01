// Muskellunge Lake Resort — media server (runs on the Mac mini).
//
// Stores + serves the post photos/videos so the app isn't capped by cloud
// storage. Uploads are gated to signed-in family members (the Supabase access
// token is validated against the cloud project). Put a STABLE public HTTPS
// tunnel in front (Tailscale Funnel or a named Cloudflare Tunnel) and set
// PUBLIC_URL to that address — the app stores the returned URLs, so it must
// not change. See README.md.

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

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: ALLOWED.length ? ALLOWED : true, methods: ["GET", "POST", "OPTIONS"] }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Public read of media. express.static honours HTTP Range requests, so video
// seeking/streaming works, and sets long-lived caching (filenames are unique).
app.use("/f", express.static(MEDIA_DIR, { maxAge: "365d", immutable: true, fallthrough: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
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
    if (!r.ok) return res.status(401).json({ error: "Invalid or expired session." });
    next();
  } catch {
    return res.status(503).json({ error: "Couldn't reach the auth service." });
  }
}

app.post("/upload", requireUser, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file received." });
    res.json({ url: `${PUBLIC_URL}/f/${req.file.filename}`, name: req.file.filename });
  });
});

app.listen(PORT, () => {
  console.log(`MLR media-server on :${PORT}`);
  console.log(`  public URL : ${PUBLIC_URL}`);
  console.log(`  media dir  : ${MEDIA_DIR}`);
  console.log(`  max file   : ${MAX_MB} MB`);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) console.warn("  ⚠ SUPABASE_URL / SUPABASE_ANON_KEY not set — uploads will be rejected.");
});
