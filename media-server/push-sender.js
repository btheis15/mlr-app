// Web Push sender — runs on the Mac mini, alongside the media server + mailer.
//
// Delivers push notifications filtered by each member's push_types — the single
// unified push list (multi-select, migration 0020 → 0034). Three categories ride
// their own senders:
//   chat      → every new committee message (not your own)  [committee_messages]
//   alerts    → broadcast alerts                            [announcements]
//   birthdays → handled by birthday-notifier.js (a separate daily job)
// The remaining five mirror an in-app `notifications` row (migration 0030/0033)
// of the matching type to a phone push, gated on the recipient's push_types:
//   committee_join · cabin_decision · post_tag · post_mention · post_reply
// (The feed already fanned out + denormalized title/body/url per recipient, so
// we just relay it.) Other notification types — post_comment, post_reaction,
// new_post, chat_mention, cabin_request (admin), broadcast — are intentionally
// NOT in push_types, so they stay in-app only / use their own admin paths.
// A self-notify tester (id in PUSH_SELF_NOTIFY_USER_IDS + push_self_notify on)
// also receives pushes for their OWN messages, to test without a second person.
//
// DORMANT unless these env vars are set (so nothing happens until you opt in):
//   SUPABASE_URL                (already set for uploads)
//   SUPABASE_SERVICE_ROLE_KEY   ⚠️ bypasses RLS — mini-only, never in the client
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   generate once with:
//                                   npx web-push generate-vapid-keys
//                               (the PUBLIC one also goes in the app as
//                                NEXT_PUBLIC_VAPID_PUBLIC_KEY — they must match)
//   VAPID_SUBJECT (optional)    mailto: or https: contact for push services
//   APP_URL (optional)          base URL for deep links + the notification icon

const APP_URL = (process.env.APP_URL || "https://mlr-app-omega.vercel.app").replace(/\/+$/, "");
const ICON = `${APP_URL}/icon-192.png`;

function mediaLabel(m) {
  if (!m) return "a message";
  switch (m.media_type) {
    case "sticker": return "a sticker";
    case "gif": return "a GIF";
    case "video": return "a video 🎬";
    default: return "a photo 📷";
  }
}

// "Jul 27" from a date-only string. Forced to UTC so a date never drifts a day
// when the mini's clock is in a negative-offset zone (the dates are date-only).
function fmtDay(d) {
  if (!d) return "";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtStay(checkIn, checkOut) {
  return `${fmtDay(checkIn)} → ${fmtDay(checkOut)}`;
}

async function start() {
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:alerts@muskellungelakeresort.com";
  // Testing only: accounts allowed to receive pushes for their OWN actions
  // (paired with the per-account push_self_notify flag). Comma-separated user ids.
  const SELF_NOTIFY_IDS = new Set((process.env.PUSH_SELF_NOTIFY_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));

  if (!SUPABASE_URL || !SERVICE_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.log("[push] dormant (set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY + SUPABASE_SERVICE_ROLE_KEY to enable)");
    return;
  }

  let webpush, createClient;
  try {
    webpush = require("web-push");
    ({ createClient } = require("@supabase/supabase-js"));
  } catch (e) {
    console.error("[push] missing deps — run `npm install` in media-server:", e && e.message);
    return;
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Send one payload to every device a user has registered; prune dead ones.
  const sendToUser = async (userId, payload) => {
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);
    for (const s of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
      } catch (e) {
        const code = e && e.statusCode;
        if (code === 404 || code === 410) {
          await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        } else {
          console.warn(`[push] send failed (${code || "?"}) user=${userId}: ${e && e.message}`);
        }
      }
    }
  };

  // De-dupe across Realtime reconnects/replays.
  const seen = new Set();
  const once = (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 5000) seen.clear();
    return true;
  };

  const handleMessage = async (mid) => {
    if (!once(`m:${mid}`)) return;
    // Let any @mentions for this message land (they're inserted right after).
    await new Promise((r) => setTimeout(r, 500));

    const { data: msg } = await sb
      .from("committee_messages")
      .select("id, committee_id, author_id, text, reply_to_id")
      .eq("id", mid)
      .maybeSingle();
    if (!msg) return;

    const [committeeRes, rosterRes, mediaRes] = await Promise.all([
      sb.from("committees").select("slug, name, emoji").eq("id", msg.committee_id).maybeSingle(),
      sb.from("committee_members").select("user_id").eq("committee_id", msg.committee_id),
      sb.from("committee_message_media").select("media_type").eq("message_id", mid),
    ]);
    const committee = committeeRes.data;
    if (!committee) return;

    const rosterIds = (rosterRes.data || []).map((r) => r.user_id);
    const others = rosterIds.filter((id) => id !== msg.author_id);
    const authorEligible = SELF_NOTIFY_IDS.has(msg.author_id);
    if (!others.length && !authorEligible) return;

    const profileIds = Array.from(new Set([...rosterIds, msg.author_id]));
    const { data: profs } = await sb
      .from("profiles")
      .select("id, display_name, push_types, push_self_notify")
      .in("id", profileIds);
    const typesById = new Map();
    const selfNotify = new Map();
    let authorName = "Someone";
    for (const p of profs || []) {
      typesById.set(p.id, p.push_types || []);
      selfNotify.set(p.id, Boolean(p.push_self_notify));
      if (p.id === msg.author_id) authorName = (p.display_name || "Someone").trim();
    }

    const body = msg.text && msg.text.trim()
      ? `${authorName}: ${msg.text.trim().slice(0, 140)}`
      : `${authorName} sent ${mediaLabel((mediaRes.data || [])[0])}`;
    const payload = {
      title: `${committee.emoji ? committee.emoji + " " : ""}${committee.name}`,
      body,
      icon: ICON,
      badge: ICON,
      tag: `committee-${committee.slug}`,
      url: `${APP_URL}/posts?c=${committee.slug}`,
    };

    // Notify the committee (minus the author) — plus the author themselves if
    // they're an allow-listed self-notify tester who opted in.
    const targets = others.slice();
    if (authorEligible && selfNotify.get(msg.author_id)) targets.push(msg.author_id);
    let sent = 0;
    for (const uid of targets) {
      const types = typesById.get(uid) || [];
      // 'chat' is the firehose category — it covers every new committee message,
      // @mentions and replies included (chat @mentions also land in the in-app
      // feed via chat_mention, which is in-app only by design).
      if (types.includes("chat")) { await sendToUser(uid, payload); sent++; }
    }
    if (sent) console.log(`[push] chat ${committee.slug}: notified ${sent}`);
  };

  const handleAlert = async (alertId) => {
    if (!once(`a:${alertId}`)) return;
    const { data: a } = await sb.from("announcements").select("id, title, body").eq("id", alertId).maybeSingle();
    if (!a) return;
    // Everyone who opted into broadcast alerts (push_types contains 'alerts').
    const { data: profs } = await sb.from("profiles").select("id").contains("push_types", ["alerts"]);
    const payload = {
      title: a.title ? `📣 ${a.title}` : "📣 Muskellunge Lake Resort",
      body: (a.body || "").slice(0, 180),
      icon: ICON,
      badge: ICON,
      tag: `alert-${a.id}`,
      url: `${APP_URL}/`,
    };
    let sent = 0;
    for (const p of profs || []) { await sendToUser(p.id, payload); sent++; }
    if (sent) console.log(`[push] alert: notified ${sent}`);
  };

  // Feed-backed push. The in-app Notifications feed (migration 0030/0033) has
  // already fanned out one row PER RECIPIENT and denormalized a ready-to-show
  // title/body/url, gated on the recipient's notif_types. We mirror a row to a
  // phone push when its type is one of the push categories AND the recipient
  // turned that category on in push_types. The actor is never the recipient
  // (the feed's _notify skips self), so there's no self-ping to guard here.
  const PUSHABLE_FEED_TYPES = new Set([
    "committee_join", "cabin_decision", "post_tag", "post_mention", "post_reply",
    "event_rsvp",
    // A member asking to join a committee (migration 0042): the feed fans a row
    // out to that committee's leads + every app admin; we relay it to a phone
    // push, gated on push_types (admins opt in via Profile → Notifications).
    "committee_join_request",
    // "Ask for Help" (migration 0037): a request reaching willing+present members,
    // a response landing for the requester, and the "✅ covered" broadcast — all
    // ride the feed-mirror path (the trigger fans out notifications rows; we relay
    // each to a phone push, gated on push_types).
    "help_request", "help_response",
  ]);
  const handleFeedNotification = async (n) => {
    if (!n || !n.id || !n.recipient_id) return;
    if (!PUSHABLE_FEED_TYPES.has(n.type)) return;
    if (!once(`notif:${n.id}`)) return;

    const { data: prof } = await sb
      .from("profiles")
      .select("push_types")
      .eq("id", n.recipient_id)
      .maybeSingle();
    if (!((prof && prof.push_types) || []).includes(n.type)) return;

    const payload = {
      title: n.title || "Muskellunge Lake Resort",
      body: n.body ? String(n.body).slice(0, 180) : null,
      icon: ICON,
      badge: ICON,
      tag: `notif-${n.id}`,
      url: n.url ? `${APP_URL}${n.url}` : `${APP_URL}/`,
    };
    await sendToUser(n.recipient_id, payload);
    console.log(`[push] ${n.type}: notified recipient`);
  };

  // A new member just signed up (handle_new_user inserts their profile row — for
  // both self sign-ups and admin invites). Tell every admin who hasn't opted out
  // (notify_new_members, default on, migration 0026) who joined and when. Email
  // comes from the GoTrue admin API (service_role); the row carries the name.
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
      icon: ICON,
      badge: ICON,
      tag: `new-member-${id}`,
      url: `${APP_URL}/profile`,
    };
    let sent = 0;
    for (const uid of targets) { await sendToUser(uid, payload); sent++; }
    if (sent) console.log(`[push] new member ${name}: notified ${sent} admin(s)`);
  };

  // A new cabin stay request was submitted (cabin_bookings INSERT) — tell every
  // admin so they can review it, minus the requester themselves. Gated on the
  // in-app notification pref `notif_types` containing 'cabin_request' (the same
  // per-type toggle in Profile → Notifications), so an admin can turn it off.
  const handleCabinRequest = async (id) => {
    if (!id) return;
    if (!once(`cbreq:${id}`)) return;
    const { data: b } = await sb
      .from("cabin_bookings")
      .select("id, cabin_id, user_id, check_in, check_out, status")
      .eq("id", id)
      .maybeSingle();
    if (!b || b.status !== "pending") return;

    const [cabinRes, reqRes, adminRes] = await Promise.all([
      sb.from("cabins").select("name").eq("id", b.cabin_id).maybeSingle(),
      sb.from("profiles").select("display_name").eq("id", b.user_id).maybeSingle(),
      sb.from("profiles").select("id, notif_types").eq("is_admin", true),
    ]);
    const cabin = cabinRes.data ? cabinRes.data.name : "a cabin";
    const name = ((reqRes.data && reqRes.data.display_name) || "").trim() || "A member";
    const targets = (adminRes.data || [])
      .filter((a) => a.id !== b.user_id && (a.notif_types || []).includes("cabin_request"))
      .map((a) => a.id);
    if (!targets.length) return;

    const payload = {
      title: "🏡 New cabin stay request",
      body: `${name} · ${cabin} · ${fmtStay(b.check_in, b.check_out)}`,
      icon: ICON,
      badge: ICON,
      tag: `cabin-req-${b.id}`,
      url: `${APP_URL}/profile`,
    };
    let sent = 0;
    for (const uid of targets) { await sendToUser(uid, payload); sent++; }
    if (sent) console.log(`[push] cabin request from ${name}: notified ${sent} admin(s)`);
  };

  // NOTE: post-comment @mentions and cabin-stay decisions used to have their own
  // bespoke handlers here. They're now delivered by handleFeedNotification above,
  // which mirrors the corresponding in-app notification row (post_mention /
  // cabin_decision) to a push — so there's a single, consistent path and we don't
  // double-send. (Cabin REQUESTS to admins stay separate, see handleCabinRequest.)

  sb.channel("push-sender")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "committee_messages" }, (e) =>
      handleMessage(e.new.id).catch((err) => console.error("[push] msg error:", err && err.message)),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (e) =>
      handleAlert(e.new.id).catch((err) => console.error("[push] alert error:", err && err.message)),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (e) =>
      handleFeedNotification(e.new).catch((err) =>
        console.error("[push] feed notification error:", err && err.message),
      ),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, (e) =>
      handleNewMember(e.new.id, e.new.display_name).catch((err) =>
        console.error("[push] new member error:", err && err.message),
      ),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "cabin_bookings" }, (e) =>
      handleCabinRequest(e.new.id).catch((err) => console.error("[push] cabin request error:", err && err.message)),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") console.log("[push] listening (chat + alerts + feed notifications + new members + cabin requests)");
    });
}

module.exports = { start };
