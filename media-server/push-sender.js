// Web Push sender — runs on the Mac mini, alongside the media server + mailer.
//
// Delivers push notifications for new committee chat messages and broadcast
// alerts, filtered by each member's push_types (multi-select, migration 0020):
//   chat      → every new committee message (not your own)
//   mentions  → @mentions / replies to you
//   alerts    → broadcast alerts
//   birthdays → handled by birthday-notifier.js (a separate daily job)
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

    const [committeeRes, rosterRes, mentionRes, mediaRes] = await Promise.all([
      sb.from("committees").select("slug, name, emoji").eq("id", msg.committee_id).maybeSingle(),
      sb.from("committee_members").select("user_id").eq("committee_id", msg.committee_id),
      sb.from("committee_message_mentions").select("mentioned_user_id").eq("message_id", mid),
      sb.from("committee_message_media").select("media_type").eq("message_id", mid),
    ]);
    const committee = committeeRes.data;
    if (!committee) return;

    const mentioned = new Set((mentionRes.data || []).map((m) => m.mentioned_user_id));
    let replyTargetAuthor = null;
    if (msg.reply_to_id) {
      const { data: rt } = await sb.from("committee_messages").select("author_id").eq("id", msg.reply_to_id).maybeSingle();
      replyTargetAuthor = rt?.author_id || null;
    }

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
      const wants = types.includes("chat") || (types.includes("mentions") && (mentioned.has(uid) || replyTargetAuthor === uid));
      if (wants) { await sendToUser(uid, payload); sent++; }
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

  sb.channel("push-sender")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "committee_messages" }, (e) =>
      handleMessage(e.new.id).catch((err) => console.error("[push] msg error:", err && err.message)),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (e) =>
      handleAlert(e.new.id).catch((err) => console.error("[push] alert error:", err && err.message)),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") console.log("[push] listening (chat messages + alerts)");
    });
}

module.exports = { start };
