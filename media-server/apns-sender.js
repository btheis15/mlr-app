// Native iOS push sender — runs on the Mac mini alongside push-sender.js.
//
// This is the APNs counterpart to push-sender.js (which does Web Push). It
// listens to the same Postgres changes and delivers to the `apns_subscriptions`
// device tokens (migration 0052), gated on the SAME `push_types` rules, so an
// iOS member gets exactly the pushes a web member would. The in-app Notifications
// feed and all gating already exist; this only adds the APNs transport.
//
// DORMANT unless these env vars are set (otherwise it logs and returns):
//   SUPABASE_URL                 (already set for uploads)
//   SUPABASE_SERVICE_ROLE_KEY    ⚠️ bypasses RLS — mini-only, never in the client
//   APNS_KEY_PATH                path to your Apple .p8 auth key file
//   APNS_KEY_ID                  the 10-char Key ID for that .p8
//   APNS_TEAM_ID                 your 10-char Apple Developer Team ID
//   APNS_BUNDLE_ID               the iOS app bundle id (e.g. com.theis.MLRApp)
//   APNS_ENV (optional)          "production" (default) or "sandbox" — only used
//                                as a fallback; each token row carries its own env.
//
// No external npm deps: the ES256 JWT is signed with Node's `crypto` and the
// HTTP/2 calls use the built-in `http2`.

const http2 = require("http2");
const crypto = require("crypto");
const fs = require("fs");

const APP_URL = (process.env.APP_URL || "https://mlr-app-omega.vercel.app").replace(/\/+$/, "");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Maps a notification/payload to an iOS notification category (so the registered
// action buttons appear). Mirrors the categories registered in NotificationActions.swift.
function categoryFor(type) {
  switch (type) {
    case "event_rsvp": return "EVENT_REMINDER";
    case "help_request":
    case "help_urgent": return "HELP_REQUEST";
    case "chat_mention": return "CHAT_MENTION";
    case "committee_join_request": return "COMMITTEE_JOIN_REQUEST";
    default: return null;
  }
}

// ── APNs transport ────────────────────────────────────────────────────────────

function createApnsDelivery() {
  const keyPath = process.env.APNS_KEY_PATH || "";
  const keyId = process.env.APNS_KEY_ID || "";
  const teamId = process.env.APNS_TEAM_ID || "";
  const bundleId = process.env.APNS_BUNDLE_ID || "";

  if (!keyPath || !keyId || !teamId || !bundleId) return null;

  let privateKey;
  try {
    privateKey = fs.readFileSync(keyPath, "utf8");
  } catch (e) {
    console.error("[apns] couldn't read APNS_KEY_PATH:", e && e.message);
    return null;
  }

  // Cache the ES256 provider JWT; APNs allows reuse up to ~60 min.
  let cachedJwt = null;
  let cachedAt = 0;
  const jwt = () => {
    const now = Math.floor(Date.now() / 1000);
    if (cachedJwt && now - cachedAt < 50 * 60) return cachedJwt;
    const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
    const payload = b64url(JSON.stringify({ iss: teamId, iat: now }));
    const signingInput = `${header}.${payload}`;
    const sig = crypto.sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
    cachedJwt = `${signingInput}.${b64url(sig)}`;
    cachedAt = now;
    return cachedJwt;
  };

  // One reusable HTTP/2 session per host (prod + sandbox).
  const sessions = {};
  const hostFor = (env) => (env === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
  const sessionFor = (env) => {
    const host = hostFor(env);
    let s = sessions[host];
    if (s && !s.closed && !s.destroyed) return s;
    s = http2.connect(host);
    s.on("error", (e) => console.warn("[apns] session error:", e && e.message));
    s.on("close", () => { if (sessions[host] === s) delete sessions[host]; });
    sessions[host] = s;
    return s;
  };

  // POST one push to a single device token. Resolves { status, reason }.
  const sendOne = (token, env, body) => new Promise((resolve) => {
    let session;
    try { session = sessionFor(env); } catch (e) { return resolve({ status: 0, reason: String(e && e.message) }); }
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "authorization": `bearer ${jwt()}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "content-type": "application/json",
    });
    let status = 0;
    let data = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (c) => { data += c; });
    req.on("error", (e) => resolve({ status: 0, reason: String(e && e.message) }));
    req.on("end", () => {
      let reason = "";
      if (data) { try { reason = (JSON.parse(data).reason) || ""; } catch { /* ignore */ } }
      resolve({ status, reason });
    });
    req.setTimeout(10000, () => { req.close(); resolve({ status: 0, reason: "timeout" }); });
    req.end(JSON.stringify(body));
  });

  // Deliver `payload` to every iOS device the user has; prune dead tokens.
  const sendToUser = async (sb, userId, payload) => {
    const { data: subs } = await sb
      .from("apns_subscriptions")
      .select("device_token, environment")
      .eq("user_id", userId);
    if (!subs || !subs.length) return 0;

    const aps = { alert: { title: payload.title || "", body: payload.body || "" }, sound: "default", badge: 1 };
    // An explicit payload.category wins; otherwise derive it from the type.
    const cat = payload.category || categoryFor(payload.type);
    if (cat) aps.category = cat;
    const body = {
      aps,
      url: payload.url || `${APP_URL}/`,
      // iOS deep-link handler reads target_type / target_id when present.
      ...(payload.target_type ? { target_type: payload.target_type } : {}),
      ...(payload.target_id ? { target_id: payload.target_id } : {}),
      // Extra top-level userInfo keys (e.g. work_item_id / request_id for the
      // WORK_FOLLOWUP actions). The iOS handler reads these off userInfo.
      ...(payload.userInfo && typeof payload.userInfo === "object" ? payload.userInfo : {}),
    };

    let sent = 0;
    for (const s of subs) {
      const { status, reason } = await sendOne(s.device_token, s.environment || "production", body);
      if (status === 200) { sent++; continue; }
      if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") {
        await sb.from("apns_subscriptions").delete()
          .eq("user_id", userId).eq("device_token", s.device_token);
      } else if (status) {
        console.warn(`[apns] send failed (${status} ${reason}) user=${userId}`);
      }
    }
    return sent;
  };

  return { sendToUser };
}

// ── Listener (forked from push-sender.js; APNs-only) ───────────────────────────

async function start() {
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const SELF_NOTIFY_IDS = new Set((process.env.PUSH_SELF_NOTIFY_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));

  const apns = createApnsDelivery();
  if (!SUPABASE_URL || !SERVICE_KEY || !apns) {
    console.log("[apns] dormant (set APNS_KEY_PATH/APNS_KEY_ID/APNS_TEAM_ID/APNS_BUNDLE_ID + SUPABASE_SERVICE_ROLE_KEY to enable)");
    return;
  }

  let createClient;
  try { ({ createClient } = require("@supabase/supabase-js")); }
  catch (e) { console.error("[apns] missing @supabase/supabase-js:", e && e.message); return; }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const seen = new Set();
  const once = (k) => { if (seen.has(k)) return false; seen.add(k); if (seen.size > 5000) seen.clear(); return true; };

  // chat — every new committee message (gated on push_types 'chat')
  const handleMessage = async (mid) => {
    if (!once(`m:${mid}`)) return;
    await new Promise((r) => setTimeout(r, 500));
    // `area` scopes to a role channel (migration 0063); null = the General channel.
    const { data: msg } = await sb.from("committee_messages")
      .select("id, committee_id, author_id, text, area").eq("id", mid).maybeSingle();
    if (!msg) return;
    const { data: committee } = await sb.from("committees").select("slug, name, emoji").eq("id", msg.committee_id).maybeSingle();
    if (!committee) return;

    // Recipients are the committee's roster members — for a role channel, only
    // those who hold that area ('Meals' or 'Meals · Lead'); for General, all.
    const { data: roster } = await sb.from("committee_roster").select("linked_user_id, roles").eq("committee_slug", committee.slug);
    const memberIds = Array.from(new Set(
      (roster || [])
        .filter((r) => r.linked_user_id)
        .filter((r) => !msg.area || (r.roles || []).includes(msg.area) || (r.roles || []).includes(`${msg.area} · Lead`))
        .map((r) => r.linked_user_id),
    ));
    const others = memberIds.filter((id) => id !== msg.author_id);
    if (!others.length) return;

    // Skip anyone who muted this channel.
    const { data: muteRows } = await sb.from("committee_area_reads")
      .select("user_id").eq("committee_id", msg.committee_id).eq("area", msg.area || "").eq("muted", true);
    const muted = new Set((muteRows || []).map((m) => m.user_id));

    const { data: profs } = await sb.from("profiles")
      .select("id, display_name, push_types").in("id", Array.from(new Set([...memberIds, msg.author_id])));
    const typesById = new Map();
    let authorName = "Someone";
    for (const p of profs || []) {
      typesById.set(p.id, p.push_types || []);
      if (p.id === msg.author_id) authorName = (p.display_name || "Someone").trim();
    }
    const body = msg.text && msg.text.trim() ? `${authorName}: ${msg.text.trim().slice(0, 140)}` : `${authorName} sent a message`;
    // Always name the channel (role area, or the General channel for area null),
    // so the push says which chat it's from — mirrors push-sender.js.
    const title = `${committee.emoji ? committee.emoji + " " : ""}${committee.name} — ${msg.area || "General"}`;
    const url = `${APP_URL}/posts?c=${committee.slug}${msg.area ? `&area=${encodeURIComponent(msg.area)}` : ""}`;
    const payload = { title, body, url, type: "chat" };
    let sent = 0;
    for (const uid of others) if (!muted.has(uid) && (typesById.get(uid) || []).includes("chat")) sent += await apns.sendToUser(sb, uid, payload);
    if (sent) console.log(`[apns] chat ${committee.slug}${msg.area ? "/" + msg.area : ""}: ${sent}`);
  };

  // chat — every new house message (gated on the SAME push_types 'chat' category
  // as committee chat, so "chat push on" covers every chat the member is in). A
  // house is a single room (no area channels, no mute table), scoped to its
  // members via profiles.house_id. Mirrors handleMessage above, minus the split.
  const handleHouseMessage = async (mid) => {
    if (!once(`hm:${mid}`)) return;
    await new Promise((r) => setTimeout(r, 500));
    const { data: msg } = await sb.from("house_messages")
      .select("id, house_id, author_id, text, deleted_at").eq("id", mid).maybeSingle();
    if (!msg || msg.deleted_at) return;
    const { data: house } = await sb.from("houses").select("slug, name, emoji").eq("id", msg.house_id).maybeSingle();
    if (!house) return;

    // Recipients are this house's members (profiles.house_id) — minus the author.
    const { data: members } = await sb.from("profiles")
      .select("id, display_name, push_types").eq("house_id", msg.house_id);
    const memberIds = (members || []).map((m) => m.id);
    const others = memberIds.filter((id) => id !== msg.author_id);
    if (!others.length) return;

    const typesById = new Map();
    let authorName = "Someone";
    for (const p of members || []) {
      typesById.set(p.id, p.push_types || []);
      if (p.id === msg.author_id) authorName = (p.display_name || "Someone").trim();
    }
    // The author may be an admin who isn't a member of this house — look up the name.
    if (authorName === "Someone") {
      const { data: ap } = await sb.from("profiles").select("display_name").eq("id", msg.author_id).maybeSingle();
      if (ap && ap.display_name) authorName = ap.display_name.trim();
    }

    const body = msg.text && msg.text.trim() ? `${authorName}: ${msg.text.trim().slice(0, 140)}` : `${authorName} sent a message`;
    const title = `${house.emoji ? house.emoji + " " : ""}${house.name}`;
    // target_type/target_id let the phone deep-link straight to the house chat
    // (RootView.resolveHouse resolves the house from the message id).
    const payload = { title, body, url: `${APP_URL}/posts?house=${house.slug}`, type: "chat", target_type: "house_message", target_id: msg.id };
    let sent = 0;
    for (const uid of others) if ((typesById.get(uid) || []).includes("chat")) sent += await apns.sendToUser(sb, uid, payload);
    if (sent) console.log(`[apns] house chat ${house.slug}: ${sent}`);
  };

  // alerts — broadcast announcements (gated on push_types 'alerts')
  const handleAlert = async (alertId) => {
    if (!once(`a:${alertId}`)) return;
    const { data: a } = await sb.from("announcements").select("id, title, body, show_banner, event_id, exclude_not_attending").eq("id", alertId).maybeSingle();
    if (!a) return;
    // An "email only" send (migration 0126's show_banner:false) never shows a
    // banner, so it shouldn't buzz phones either — push rides with the banner.
    if (a.show_banner === false) return;
    const { data: profs } = await sb.from("profiles").select("id").contains("push_types", ["alerts"]);
    // Same "not going" exclusion as the banner/Activity-tab/email channels
    // (migration 0096/0127) — an alert linked to an event skips anyone who
    // explicitly RSVP'd "Can't make it" to it.
    let excluded = new Set();
    if (a.exclude_not_attending && a.event_id) {
      const { data: notGoing } = await sb
        .from("event_attendance")
        .select("user_id")
        .eq("event_id", a.event_id)
        .eq("status", "not_going");
      excluded = new Set((notGoing || []).map((r) => r.user_id));
    }
    const payload = { title: a.title ? `📣 ${a.title}` : "📣 Muskellunge Lake Resort", body: (a.body || "").slice(0, 180), url: `${APP_URL}/`, type: "broadcast" };
    let sent = 0;
    for (const p of profs || []) {
      if (excluded.has(p.id)) continue;
      sent += await apns.sendToUser(sb, p.id, payload);
    }
    if (sent) console.log(`[apns] alert: ${sent}`);
  };

  // feed-backed pushes — mirror an in-app notifications row (same gating as web).
  const PUSHABLE = new Set([
    "committee_join", "cabin_decision", "post_tag", "post_mention", "post_reply",
    "event_rsvp", "committee_join_request", "help_request", "help_response", "help_urgent",
    "work_item_created", "house_stay_created",
    // Meeting scheduling (migration 0116) — proposal + finalized, same gating.
    "meeting_proposed", "meeting_scheduled",
    // Quick poll started in a committee/house chat (migration 0147), same gating.
    "chat_poll_created",
    // Cabin guest message (migration 0120).
    "cabin_message",
    // Sign-up slot reminder (migration 0140) — override push, like help_urgent.
    "signup_reminder",
    // Tournament brackets (migration 0144) — bracket set, next match ready, champion.
    "tournament_published", "tournament_match_ready", "tournament_champion",
  ]);
  const handleFeed = async (n) => {
    if (!n || !n.id || !n.recipient_id || !PUSHABLE.has(n.type)) return;
    if (!once(`notif:${n.id}`)) return;
    const { data: prof } = await sb.from("profiles").select("push_types").eq("id", n.recipient_id).maybeSingle();
    const pushTypes = (prof && prof.push_types) || [];
    // help_urgent + signup_reminder override per-category picks (buzz anyone
    // with push on) — see push-sender.js for the rationale.
    if (n.type === "help_urgent" || n.type === "signup_reminder") { if (pushTypes.length === 0) return; }
    else if (!pushTypes.includes(n.type)) return;
    const payload = {
      title: n.title || "Muskellunge Lake Resort",
      body: n.body ? String(n.body).slice(0, 180) : "",
      url: n.url ? `${APP_URL}${n.url}` : `${APP_URL}/`,
      type: n.type,
      target_type: n.entity_type || undefined,
      target_id: n.entity_id || undefined,
    };
    // For join requests the notification's entity_id is the REQUEST id (0060).
    // Forward request_id + committee_id so the phone's inline Approve button can
    // act on the specific request and deep-link to the committee.
    if (n.type === "committee_join_request" && n.entity_id) {
      const { data: reqRow } = await sb
        .from("committee_join_requests")
        .select("id, committee_id")
        .eq("id", n.entity_id)
        .maybeSingle();
      if (reqRow) {
        payload.userInfo = { request_id: reqRow.id, committee_id: reqRow.committee_id };
      }
    }
    const sent = await apns.sendToUser(sb, n.recipient_id, payload);
    if (sent) console.log(`[apns] ${n.type}: ${sent}`);
  };

  // A new member just verified their email (profiles.joined_at freshly stamped —
  // migration 0054). Tell every admin who hasn't opted out (notify_new_members,
  // default on). Mirrors push-sender.js's handleNewMember/maybeNewMember exactly,
  // just delivered over APNs instead of web push.
  const handleNewMember = async (id, nameFromRow) => {
    if (!id) return;
    if (!once(`nm:${id}`)) return;

    const { data: admins } = await sb
      .from("profiles")
      .select("id")
      .eq("is_admin", true)
      .eq("notify_new_members", true);
    const targets = (admins || []).map((a) => a.id).filter((aid) => aid !== id);
    if (!targets.length) return;

    let name = (nameFromRow || "").trim();
    let email = "";
    try {
      const { data: u } = await sb.auth.admin.getUserById(id);
      email = (u && u.user && u.user.email) || "";
    } catch { /* email is best-effort */ }
    if (!name) name = email ? email.split("@")[0] : "A new member";

    const payload = {
      title: "👋 New member joined",
      body: email ? `${name} (${email}) just joined` : `${name} just joined`,
      url: `${APP_URL}/profile`,
      type: "new_member",
    };
    let sent = 0;
    for (const uid of targets) sent += await apns.sendToUser(sb, uid, payload);
    if (sent) console.log(`[apns] new member ${name}: notified ${sent} admin(s)`);
  };

  // Same freshness guard as push-sender.js: profiles uses the default REPLICA
  // IDENTITY, so a realtime UPDATE's `old` carries only the primary key — gate
  // on joined_at being freshly set rather than "changed" to avoid re-firing on
  // every edit / re-sign-in of an existing member.
  const JOIN_FRESH_MS = 10 * 60 * 1000;
  const maybeNewMember = (row) => {
    if (!row || !row.joined_at) return;
    // Sent via /admin/invite-link (migration 0085) — the inviting admin
    // already knows exactly who's joining, so skip the "new member" push.
    if (row.invited_via === "invite_link") return;
    const t = Date.parse(row.joined_at);
    if (!Number.isFinite(t) || Date.now() - t > JOIN_FRESH_MS) return;
    handleNewMember(row.id, row.display_name).catch((err) =>
      console.error("[apns] new member error:", err && err.message),
    );
  };

  sb.channel("apns-sender")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "committee_messages" },
      (e) => handleMessage(e.new.id).catch((err) => console.error("[apns] msg error:", err && err.message)))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "house_messages" },
      (e) => handleHouseMessage(e.new.id).catch((err) => console.error("[apns] house msg error:", err && err.message)))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" },
      (e) => handleAlert(e.new.id).catch((err) => console.error("[apns] alert error:", err && err.message)))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" },
      (e) => handleFeed(e.new).catch((err) => console.error("[apns] feed error:", err && err.message)))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, (e) => maybeNewMember(e.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (e) => maybeNewMember(e.new))
    .subscribe((status) => { if (status === "SUBSCRIBED") console.log("[apns] listening (committee + house chat + alerts + feed notifications + verified new members)"); });
}

module.exports = { start, createApnsDelivery };
