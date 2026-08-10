// Members-only media reads.
//
// `/f` used to be fully public — unguessable UUID URLs, but anyone holding a link
// could view it forever, and that link outlived the person's membership. Now a
// short-lived signed token is required.
//
// ⚠️ WHY A TOKEN IN THE QUERY STRING, AND NOT THE TWO OBVIOUS ALTERNATIVES
//
// 1. An `Authorization: Bearer` header CANNOT work. `<img src>` and `<video src>`
//    are fetched by the browser itself, and there is no way to attach a header to
//    them. Making it work would mean fetching every photo through JS into a blob
//    URL, which destroys HTTP caching and breaks Range requests — i.e. video
//    seeking and the native player.
//
// 2. A COOKIE cannot work either. The media server is a different origin from the
//    app (mlr-media.duckdns.org vs the Vercel host), so it would have to be a
//    third-party cookie with SameSite=None. Safari/iOS blocks those outright, and
//    most of this family is on iPhones — it would fail exactly where it matters.
//
// So: `…/photo.jpg?t=<token>`. The browser sends it naturally on any element, it
// survives Range requests, and it needs no cooperation from the media element.
// This is the same reasoning `/dropbox-zip` already uses for its token, since an
// `<a download>` or form submit can't set headers either.
//
// The token is an HMAC over an expiry, signed with a server secret. It is NOT
// per-file: signing every URL individually would mean a round trip per photo, and
// a grid loads 40 at once. It's a bearer capability for "this person is a logged-in
// member right now", which is exactly the check being enforced.
//
// ⚠️ STABLE FOR ITS LIFETIME, deliberately. The token is derived from a rounded
// time window rather than "now", so every client gets the SAME token string for a
// given window. If it changed per request the URL would change per request, every
// image would miss the browser cache, and this feature would make the app slower
// while adding no security.

const crypto = require("crypto");

// Reuse the service-role key as the signing secret when a dedicated one isn't set:
// it's already present, already secret, and never leaves the mini. MEDIA_TOKEN_SECRET
// overrides it if you'd rather rotate them independently.
const SECRET =
  process.env.MEDIA_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
// How long a token stays valid. Also the cache-stability window — a longer life
// means better browser caching and a longer window for a leaked link.
const TTL_MS = Number(process.env.MEDIA_TOKEN_TTL_HOURS || 24) * 3600 * 1000;
// ⚠️ DEFAULTS OFF, ON PURPOSE. Enforcement must not switch on until the CLIENT is
// appending `?t=` to every media URL — otherwise every photo and video in the app
// goes 403 the instant the mini restarts. Roll out in two steps:
//   1. ship the client changes with MEDIA_AUTH unset (tokens present, ignored)
//   2. confirm media still renders everywhere, then set MEDIA_AUTH=on in .env
// Flipping this is a one-line change and instantly reversible.
const ENABLED = String(process.env.MEDIA_AUTH || "off").toLowerCase() === "on";

/** Paths that must stay public even with auth on. */
function isAlwaysPublic(reqPath) {
  // The privacy policy has to be reachable with no login (App Store requirement),
  // and /assets holds repo-shipped UI images (pay-method logos) that render on
  // screens a guest can see, including the sign-in page itself.
  return reqPath === "/privacy" || reqPath.startsWith("/assets/");
}

/** The window a timestamp falls in. Rounding is what makes the token stable. */
function windowFor(ms) {
  return Math.floor(ms / TTL_MS);
}

function sign(windowIndex) {
  return crypto.createHmac("sha256", SECRET).update(`media:${windowIndex}`).digest("base64url").slice(0, 43);
}

/**
 * The token to hand a logged-in member. Same string for everyone in this window,
 * so it caches; rotates automatically as windows advance.
 */
function issueToken(now = Date.now()) {
  const w = windowFor(now);
  return { token: `${w}.${sign(w)}`, expiresAt: new Date((w + 1) * TTL_MS).toISOString() };
}

/**
 * Is this token currently valid? Accepts the CURRENT and PREVIOUS window, so a
 * client holding a token that rotates mid-session doesn't suddenly get 403s on
 * half a photo grid — it just picks up the new one on its next refresh.
 */
function verifyToken(token, now = Date.now()) {
  if (!SECRET || typeof token !== "string" || !token.includes(".")) return false;
  const [wRaw, sig] = token.split(".", 2);
  const w = Number(wRaw);
  if (!Number.isFinite(w) || !sig) return false;
  const current = windowFor(now);
  if (w !== current && w !== current - 1) return false;
  const expected = sign(w);
  // Constant-time compare — lengths match by construction, but guard anyway.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Express middleware for `/f`. Rejects anything without a valid token.
 *
 * Accepts the token from `?t=` (how media elements send it) or an Authorization
 * header (for programmatic callers and the existing zip endpoints).
 */
function requireMediaToken(req, res, next) {
  if (!ENABLED) return next();
  if (!SECRET) {
    // Fail OPEN rather than blackholing every photo in the app if the secret is
    // missing — a misconfiguration should be loud, not a silent outage.
    console.warn("[media-auth] no signing secret set — serving /f publicly");
    return next();
  }
  if (isAlwaysPublic(req.path)) return next();

  const fromQuery = typeof req.query.t === "string" ? req.query.t : "";
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const token = fromQuery || (m ? m[1] : "");
  if (verifyToken(token)) return next();

  // 403, not 401: a browser must not pop a basic-auth dialog over a broken image.
  res.status(403).json({ error: "This photo is only viewable in the MLR app." });
}

module.exports = { ENABLED, TTL_MS, issueToken, verifyToken, requireMediaToken, isAlwaysPublic };
