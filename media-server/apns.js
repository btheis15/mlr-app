// Native Apple Push Notification service (APNs) sender for the MLR iOS app.
//
// Token-based auth (a .p8 signing key → an ES256 JWT) over HTTP/2. The iOS app
// (ios/MLRApp) registers its APNs device token into the `apns_subscriptions`
// table (user_id, device_token, environment); push-sender.js reads that table
// and delivers here, alongside the existing web-push arm.
//
// Zero extra dependencies — Node's built-in `http2` + `crypto` do JWT signing
// and the HTTP/2 calls, so nothing new to `npm install`.
//
// DORMANT unless all four env vars are set (so it's a no-op until you opt in):
//   APNS_KEY_PATH    absolute path to the .p8 (keep it OUTSIDE the repo)
//   APNS_KEY_ID      the key's 10-char Key ID
//   APNS_TEAM_ID     your Apple Developer Team ID
//   APNS_BUNDLE_ID   the app's bundle id (becomes the apns-topic)

const http2 = require("http2");
const crypto = require("crypto");
const fs = require("fs");

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

const b64url = (input) =>
  Buffer.from(input).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");

// Build a sender. Returns { configured, send }. When a var is missing or the key
// can't be read it logs WHY (so "[apns] dormant …" points at the real cause) and
// returns configured:false; the caller then simply skips the APNs arm.
function create() {
  const keyPath = process.env.APNS_KEY_PATH || "";
  const keyId = process.env.APNS_KEY_ID || "";
  const teamId = process.env.APNS_TEAM_ID || "";
  const bundleId = process.env.APNS_BUNDLE_ID || "";

  const missing = [
    ["APNS_KEY_PATH", keyPath],
    ["APNS_KEY_ID", keyId],
    ["APNS_TEAM_ID", teamId],
    ["APNS_BUNDLE_ID", bundleId],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.log(`[apns] dormant (missing ${missing.join(", ")})`);
    return { configured: false };
  }

  let privateKey;
  try {
    privateKey = fs.readFileSync(keyPath, "utf8");
  } catch (e) {
    console.log(`[apns] dormant (can't read key at ${keyPath}: ${e && e.message})`);
    return { configured: false };
  }

  // ── ES256 JWT, cached ────────────────────────────────────────────────────
  // Apple wants the token refreshed every 20–60 min and rejects re-signing too
  // often, so we re-mint at ~50 min.
  let cachedJwt = null;
  let jwtMadeAt = 0;
  const jwt = () => {
    const now = Math.floor(Date.now() / 1000);
    if (cachedJwt && now - jwtMadeAt < 50 * 60) return cachedJwt;
    const signingInput = `${b64url(JSON.stringify({ alg: "ES256", kid: keyId }))}.${b64url(
      JSON.stringify({ iss: teamId, iat: now }),
    )}`;
    const sig = crypto.sign("SHA256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363", // JOSE wants raw R||S, not DER
    });
    cachedJwt = `${signingInput}.${b64url(sig)}`;
    jwtMadeAt = now;
    return cachedJwt;
  };

  // ── Persistent HTTP/2 sessions, lazily opened + self-healing ──────────────
  const sessions = {};
  const sessionFor = (env) => {
    const host = HOSTS[env] || HOSTS.production;
    const existing = sessions[host];
    if (existing && !existing.destroyed && !existing.closed) return existing;
    const s = http2.connect(host);
    s.on("error", () => {}); // swallow — the next send reconnects
    s.on("close", () => {
      if (sessions[host] === s) delete sessions[host];
    });
    sessions[host] = s;
    return s;
  };

  // The unified web-push payload ({title, body, url, tag, …}) → an APNs body.
  // We carry deep-link + action fields the iOS app's tap handler / categories
  // already read (target_type/target_id, committee_id, request_id, category);
  // unknown fields are simply absent. NOTE: payload.badge in the web payload is
  // an icon URL, not a count, so it is deliberately NOT mapped to aps.badge.
  const buildBody = (p) => {
    const aps = { alert: { title: p.title || "Muskellunge Lake Resort" }, sound: "default" };
    if (p.body) aps.alert.body = String(p.body).slice(0, 300);
    if (p.category) aps.category = p.category;
    const out = { aps };
    for (const k of ["url", "target_type", "target_id", "committee_id", "request_id", "event_id"]) {
      if (p[k] != null && p[k] !== "") out[k] = String(p[k]);
    }
    return JSON.stringify(out);
  };

  // Send one notification to one device token. Resolves { ok, dead } — `dead`
  // means the token is gone (410 / BadDeviceToken / Unregistered) and the caller
  // should delete its row.
  const sendOne = (item, body) =>
    new Promise((resolve) => {
      let session;
      try {
        session = sessionFor(item.environment);
      } catch {
        return resolve({ ok: false, dead: false });
      }
      let req;
      try {
        req = session.request({
          ":method": "POST",
          ":path": `/3/device/${item.token}`,
          authorization: `bearer ${jwt()}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 3600),
          ...(body.length ? { "content-type": "application/json" } : {}),
          ...(item.collapseId ? { "apns-collapse-id": item.collapseId } : {}),
        });
      } catch {
        return resolve({ ok: false, dead: false });
      }
      let status = 0;
      let data = "";
      req.on("response", (h) => {
        status = h[":status"];
      });
      req.setEncoding("utf8");
      req.on("data", (d) => {
        data += d;
      });
      req.on("error", () => resolve({ ok: false, dead: false }));
      req.on("end", () => {
        if (status === 200) return resolve({ ok: true, dead: false });
        let reason = "";
        try {
          reason = JSON.parse(data || "{}").reason || "";
        } catch {}
        const dead = status === 410 || reason === "BadDeviceToken" || reason === "Unregistered";
        if (!dead) {
          console.warn(`[apns] send failed (${status || "?"} ${reason}) token=${item.token.slice(0, 8)}…`);
        }
        resolve({ ok: false, dead });
      });
      req.end(body);
    });

  // Deliver `payload` to every token in `items` ([{token, environment}]).
  // Returns { sent, dead:[token] } so the caller can prune dead tokens.
  const send = async (items, payload) => {
    const body = buildBody(payload);
    const collapseId = payload.tag ? String(payload.tag).slice(0, 64) : null;
    const dead = [];
    let sent = 0;
    for (const it of items) {
      const r = await sendOne({ ...it, collapseId }, body);
      if (r.ok) sent++;
      if (r.dead) dead.push(it.token);
    }
    return { sent, dead };
  };

  return { configured: true, send };
}

module.exports = { create };
