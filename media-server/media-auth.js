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
// ⚠️⚠️ THE FALLBACK IS A TRAP — read this before touching either variable.
//
// An unset MEDIA_TOKEN_SECRET does NOT mean "tokens are unsigned". It means they are
// being signed with the SERVICE-ROLE KEY. So setting MEDIA_TOKEN_SECRET for the first
// time is a KEY ROTATION, not a fix — and on 2026-08-10 that rotation 403'd every
// photo in the app, because a check that looked only at MEDIA_TOKEN_SECRET concluded
// the server had no signing key at all.
const SECRET =
  process.env.MEDIA_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Keys a token may be signed with. The FIRST is the one we issue with; the rest are
 * accepted for verification only.
 *
 * Rotating a single-key HMAC scheme instantly invalidates every token already cached
 * on every member's device — a fleet-wide outage lasting until each client happens to
 * refetch (up to TTL_MS). That is not an acceptable cost for a routine key change, and
 * it is exactly what happened the day enforcement went on. Accepting an overlapping set
 * makes rotation a non-event:
 *
 *   1. move the outgoing key into MEDIA_TOKEN_SECRETS_LEGACY (comma-separated)
 *   2. set the new key as MEDIA_TOKEN_SECRET, restart
 *   3. after 2 * MEDIA_TOKEN_TTL_HOURS every client has re-fetched — drop the legacy entry
 *
 * Legacy keys widen only WHICH SIGNATURES VERIFY, never who may obtain a token (that is
 * still the approval gate on /media-token), and each is bounded by the same window check.
 */
const ACCEPTED_KEYS = [
  ...new Set(
    [
      SECRET,
      // The fallback key stays ACCEPTED (never issued) even once a dedicated
      // MEDIA_TOKEN_SECRET is set, so adopting one is not a rotation at all — every
      // token already minted under the fallback keeps verifying. It costs nothing: an
      // attacker cannot sign with the service-role key without already having it, and
      // holding it would mean full database compromise, next to which minting a media
      // token is irrelevant.
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      ...String(process.env.MEDIA_TOKEN_SECRETS_LEGACY || "")
        .split(",")
        .map((s) => s.trim()),
    ].filter(Boolean)
  ),
];
// How long a token stays valid. Also the cache-stability window — a longer life
// means better browser caching and a longer window for a leaked link.
const TTL_MS = Number(process.env.MEDIA_TOKEN_TTL_HOURS || 24) * 3600 * 1000;
// ⚠️ DEFAULTS OFF, ON PURPOSE. Enforcement must not switch on until the CLIENT is
// appending `?t=` to every media URL — otherwise every photo and video in the app
// goes 403 the instant the mini restarts. Roll out in two steps:
//   1. ship the client changes with MEDIA_AUTH unset (tokens present, ignored)
//   2. confirm media still renders everywhere, then set MEDIA_AUTH=on in .env
// Flipping this is a one-line change and instantly reversible.
const MODE = String(process.env.MEDIA_AUTH || "off").toLowerCase();
const ENABLED = MODE === "on";
/**
 * ⭐ REPORT-ONLY MODE (`MEDIA_AUTH=report`) — the safe way to turn this on.
 *
 * Serves every media read exactly as if auth were off, but LOGS what it *would* have
 * blocked. This exists because flipping straight to `on` broke the whole family's
 * photos twice in one afternoon, and both times the evidence needed to predict it
 * ("are real clients actually sending a token?") was only obtainable by breaking it.
 *
 * Rollout that cannot fail:
 *   1. MEDIA_AUTH=report, restart. Nothing changes for anyone.
 *   2. Have a member open the app and scroll an album.
 *   3. grep the log for "[media-auth] WOULD-BLOCK". Zero lines from real clients
 *      (only `tok=no` probes) means every client is signing correctly.
 *   4. Only then MEDIA_AUTH=on.
 *
 * Step 3 is the check that was missing all along. Do not skip it.
 */
const REPORT_ONLY = MODE === "report";

/**
 * ⚠️⚠️ DO NOT reintroduce a path-prefix exemption here. This function is retained only
 * so callers outside the `/f` chain can ask the question; `requireMediaToken` no longer
 * consults it, because doing so was an AUTHENTICATION BYPASS FOR THE ENTIRE MEDIA
 * LIBRARY:
 *
 *   GET /f/assets/%2e%2e/posts/2026-06/<uuid>.jpg   ->   200, no token, full private photo
 *
 * `requireMediaToken` is mounted at `/f`, so `req.path` inside it is /f-RELATIVE —
 * `/assets/…` and `/privacy` are top-level Express routes that can never legitimately
 * appear there. But a crafted path DOES satisfy `startsWith("/assets/")`, so the token
 * check was skipped, and `express.static` then normalized `%2e%2e` to `..` and served
 * the private file from inside MEDIA_DIR. Found by an adversarial audit probe.
 *
 * The real `/privacy` and `/assets` routes are mounted at the top level and are not
 * behind this middleware at all, so nothing needed an exemption in the first place.
 */
function isAlwaysPublic(reqPath) {
  return reqPath === "/privacy" || reqPath.startsWith("/assets/");
}

/**
 * Is this request path free of traversal tricks?
 *
 * Decodes repeatedly (to catch `%252e%252e` double-encoding) and rejects any `..`
 * segment, backslash, or NUL. `express.static` refuses to serve OUTSIDE its root, which
 * is why this was not a secrets-disclosure bug — but "inside the root" still means the
 * whole media library, and traversal also lets a path dodge prefix-based checks earlier
 * in the chain (the `_trash` quarantine block being the one that matters: deleted photos
 * are meant to be unreachable for their 7-day hold).
 *
 * Applied to EVERY `/f` request, token or not — a valid token is permission to read
 * media, not permission to address it in a way that sidesteps the chain.
 */
function pathIsSafe(rawPath) {
  let p = String(rawPath == null ? "" : rawPath);
  for (let i = 0; i < 4; i++) {
    if (p.includes("\0") || p.includes("\\")) return false;
    if (/(^|\/)\.\.(\/|$)/.test(p)) return false;
    let decoded;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      return false; // malformed percent-encoding — refuse rather than guess
    }
    if (decoded === p) return true; // fully decoded, and clean at every step
    p = decoded;
  }
  return false; // absurdly nested encoding; nothing legitimate looks like this
}

/** The window a timestamp falls in. Rounding is what makes the token stable. */
function windowFor(ms) {
  return Math.floor(ms / TTL_MS);
}

function sign(windowIndex, key = SECRET) {
  return crypto.createHmac("sha256", key).update(`media:${windowIndex}`).digest("base64url").slice(0, 43);
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
  // Try every accepted key (primary first, then any legacy key mid-rotation). The
  // window check above already bounds validity, so a legacy key widens WHICH
  // signatures verify, never for how long.
  const a = Buffer.from(sig);
  for (const key of ACCEPTED_KEYS) {
    const b = Buffer.from(sign(w, key));
    // Constant-time compare — lengths match by construction, but guard anyway.
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Express middleware for `/f`. Rejects anything without a valid token.
 *
 * Accepts the token from `?t=` (how media elements send it) or an Authorization
 * header (for programmatic callers and the existing zip endpoints).
 */
function requireMediaToken(req, res, next) {
  // ⭐ TRAVERSAL IS REJECTED UNCONDITIONALLY — before the ENABLED and SECRET checks,
  // not after. A traversal path is malformed regardless of whether media auth is
  // enforcing: the handlers downstream (the `_trash` quarantine block, the `?dl=1`
  // original-file resolver) make PREFIX-BASED decisions on req.path, so a `..` slips
  // past them whether or not a token was required. Putting this behind `if (!ENABLED)`
  // would leave deleted-photo quarantine bypassable any time enforcement is off.
  if (!pathIsSafe(req.path)) {
    return res.status(400).json({ error: "Bad request." });
  }
  // Report-only: serve everything, but record what enforcement WOULD have blocked, so
  // the rollout can be verified from real client traffic instead of by breaking it.
  if (REPORT_ONLY) {
    if (SECRET) {
      const t = (typeof req.query.t === "string" && req.query.t) || (/^Bearer (.+)$/.exec(req.headers.authorization || "") || [])[1] || "";
      if (!verifyToken(t)) {
        console.warn(`[media-auth] WOULD-BLOCK ${req.path} tok=${t ? "invalid" : "missing"} ua=${(req.headers["user-agent"] || "-").slice(0, 60)}`);
      }
    }
    return next();
  }
  if (!ENABLED) return next();
  if (!SECRET) {
    // Fail OPEN rather than blackholing every photo in the app if the secret is
    // missing — a misconfiguration should be loud, not a silent outage.
    console.warn("[media-auth] no signing secret set — serving /f publicly");
    return next();
  }
  // ⚠️ NO isAlwaysPublic() CHECK HERE — see the note on that function. This middleware
  // only ever runs for /f, where nothing is legitimately public; consulting it let
  // `/f/assets/%2e%2e/…` skip the token entirely and serve any photo in the library.

  const fromQuery = typeof req.query.t === "string" ? req.query.t : "";
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const token = fromQuery || (m ? m[1] : "");
  if (verifyToken(token)) return next();

  // 403, not 401: a browser must not pop a basic-auth dialog over a broken image.
  res.status(403).json({ error: "This photo is only viewable in the MLR app." });
}

module.exports = { ENABLED, REPORT_ONLY, MODE, TTL_MS, issueToken, verifyToken, requireMediaToken, isAlwaysPublic, pathIsSafe, ACCEPTED_KEYS };
