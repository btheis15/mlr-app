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
      .select("id, committee_id, author_id, text, reply_to_id, area")
      .eq("id", mid)
      .maybeSingle();
    if (!msg) return;

    const [committeeRes, mediaRes, muteRes] = await Promise.all([
      sb.from("committees").select("slug, name, emoji").eq("id", msg.committee_id).maybeSingle(),
      sb.from("committee_message_media").select("media_type").eq("message_id", mid),
      sb.from("committee_area_reads").select("user_id").eq("committee_id", msg.committee_id).eq("area", msg.area || "").or(`muted.eq.true,muted_until.gt.${new Date().toISOString()}`),
    ]);
    const committee = committeeRes.data;
    if (!committee) return;

    // Roster members — for a role channel only those who hold that area; for the
    // General channel (area null) everyone on the committee roster.
    const { data: roster } = await sb.from("committee_roster").select("linked_user_id, roles").eq("committee_slug", committee.slug);
    const rosterIds = Array.from(new Set(
      (roster || [])
        .filter((r) => r.linked_user_id)
        .filter((r) => !msg.area || (r.roles || []).includes(msg.area) || (r.roles || []).includes(`${msg.area} · Lead`))
        .map((r) => r.linked_user_id),
    ));
    const muted = new Set(((muteRes && muteRes.data) || []).map((m) => m.user_id));
    const others = rosterIds.filter((id) => id !== msg.author_id && !muted.has(id));
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
      // Always name the channel so a push says WHICH chat it's from — a role
      // area (e.g. "Family Fest — Meals") or the committee-wide General channel
      // (area null → "Family Fest — General"), matching the in-app channel list.
      title: `${committee.emoji ? committee.emoji + " " : ""}${committee.name} — ${msg.area || "General"}`,
      body,
      icon: ICON,
      badge: ICON,
      tag: `committee-${committee.slug}${msg.area ? "-" + msg.area : ""}`,
      // &m=<message id> so tapping the push scrolls straight to THIS message
      // (PostsView/CommitteeChat's deep-link handling), not just the room —
      // mirrors the in-app chat_mention notification's url (migration 0063).
      url: `${APP_URL}/posts?c=${committee.slug}${msg.area ? `&area=${encodeURIComponent(msg.area)}` : ""}&m=${msg.id}`,
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

  // Every new house message → a phone push, gated on the SAME push_types 'chat'
  // category as committee chat (so "chat push on" covers every chat the member is
  // in). A house is a single room scoped to its members (profiles.house_id),
  // with its own per-member mute on house_reads (0155) mirroring the committee
  // area mute above.
  const handleHouseMessage = async (mid) => {
    if (!once(`hm:${mid}`)) return;
    // Let any @mentions for this message land (they're inserted right after).
    await new Promise((r) => setTimeout(r, 500));

    const { data: msg } = await sb
      .from("house_messages")
      .select("id, house_id, author_id, text, reply_to_id, deleted_at")
      .eq("id", mid)
      .maybeSingle();
    if (!msg || msg.deleted_at) return;

    const [houseRes, mediaRes, membersRes, muteRes] = await Promise.all([
      sb.from("houses").select("slug, name, emoji").eq("id", msg.house_id).maybeSingle(),
      sb.from("house_message_media").select("media_type").eq("message_id", mid),
      sb.from("profiles").select("id, display_name, push_types, push_self_notify").eq("house_id", msg.house_id),
      sb.from("house_reads").select("user_id").eq("house_id", msg.house_id).or(`muted.eq.true,muted_until.gt.${new Date().toISOString()}`),
    ]);
    const house = houseRes.data;
    if (!house) return;

    // Recipients are this house's members (profiles.house_id) — minus the author + anyone muted.
    const members = membersRes.data || [];
    const memberIds = members.map((m) => m.id);
    const muted = new Set(((muteRes && muteRes.data) || []).map((m) => m.user_id));
    const others = memberIds.filter((id) => id !== msg.author_id && !muted.has(id));
    const authorEligible = SELF_NOTIFY_IDS.has(msg.author_id);
    if (!others.length && !authorEligible) return;

    const typesById = new Map();
    const selfNotify = new Map();
    let authorName = "Someone";
    for (const p of members) {
      typesById.set(p.id, p.push_types || []);
      selfNotify.set(p.id, Boolean(p.push_self_notify));
      if (p.id === msg.author_id) authorName = (p.display_name || "Someone").trim();
    }
    // The author may be an admin who isn't a member of this house.
    if (authorName === "Someone") {
      const { data: ap } = await sb.from("profiles").select("display_name, push_self_notify").eq("id", msg.author_id).maybeSingle();
      if (ap) { authorName = (ap.display_name || "Someone").trim(); selfNotify.set(msg.author_id, Boolean(ap.push_self_notify)); }
    }

    const body = msg.text && msg.text.trim()
      ? `${authorName}: ${msg.text.trim().slice(0, 140)}`
      : `${authorName} sent ${mediaLabel((mediaRes.data || [])[0])}`;
    const payload = {
      title: `${house.emoji ? house.emoji + " " : ""}${house.name}`,
      body,
      icon: ICON,
      badge: ICON,
      tag: `house-${house.slug}`,
      // &m=<message id> — see the matching comment in handleCommitteeMessage.
      url: `${APP_URL}/posts?house=${house.slug}&m=${msg.id}`,
    };

    const targets = others.slice();
    if (authorEligible && selfNotify.get(msg.author_id)) targets.push(msg.author_id);
    let sent = 0;
    for (const uid of targets) {
      if ((typesById.get(uid) || []).includes("chat")) { await sendToUser(uid, payload); sent++; }
    }
    if (sent) console.log(`[push] house chat ${house.slug}: notified ${sent}`);
  };

  const handleAlert = async (alertId) => {
    if (!once(`a:${alertId}`)) return;
    const { data: a } = await sb.from("announcements").select("id, title, body, show_banner, event_id, exclude_not_attending").eq("id", alertId).maybeSingle();
    if (!a) return;
    // An "email only" send (migration 0126's show_banner:false) never shows a
    // banner, so it shouldn't buzz phones either — push rides with the banner.
    if (a.show_banner === false) return;
    // Everyone who opted into broadcast alerts (push_types contains 'alerts').
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
    const payload = {
      title: a.title ? `📣 ${a.title}` : "📣 Muskellunge Lake Resort",
      body: (a.body || "").slice(0, 180),
      icon: ICON,
      badge: ICON,
      tag: `alert-${a.id}`,
      url: `${APP_URL}/`,
    };
    let sent = 0;
    for (const p of profs || []) {
      if (excluded.has(p.id)) continue;
      await sendToUser(p.id, payload);
      sent++;
    }
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
    // URGENT help (migration 0046): an emergency goes to EVERY member. It's an
    // OVERRIDE push — anyone with phone push on gets buzzed regardless of their
    // per-category picks (handled below), so it isn't gated on push_types[type].
    "help_urgent",
    // A new work item was added (migration 0070): relay to a phone push, gated
    // on push_types (off by default — a member opts in via Profile → Notifications).
    "work_item_created",
    // A new stay was added to a house calendar (migration 0071): the feed fans a
    // row out to that house's members + every app admin; relay to a phone push,
    // gated on push_types (off by default — opt in via Profile → Notifications).
    "house_stay_created",
    // Meeting scheduling (migration 0116): a proposal fans out to every member of
    // the committee/house room ("mark when you're free"), and finalizing fans out
    // "meeting set" with the join link. Both relay to a phone push, gated on
    // push_types (off by default — opt in via Profile → Notifications).
    "meeting_proposed", "meeting_scheduled",
    // A quick poll started in a committee/house chat (migration 0147) — relay to
    // a phone push, gated on push_types (off by default — opt in via Profile →
    // Notifications).
    "chat_poll_created",
    // A note from whoever runs a place to its current/upcoming guests (migration
    // 0120) — relay to a phone push, gated on push_types.
    "cabin_message",
    // A sign-up slot reminder (migration 0140) — fanned out by the pg_cron
    // run_signup_reminders() to everyone signed up for a slot, some lead time
    // before it, plus the manual "notify this slot" send (migration 0158/0159).
    // A normal category, gated on push_types — but ON by default for anyone
    // with push already on (migration 0159 backfills existing push-on members
    // + it's in DEFAULT_PUSH_TYPES for new ones), since it only ever fires for
    // a slot the member themself signed up for.
    "signup_reminder",
    // Tournament brackets (migration 0144): the bracket going live, a member's
    // next match becoming ready, and the champion being crowned. All relay to a
    // phone push, gated on push_types (off by default — opt in via Profile →
    // Notifications).
    "tournament_published", "tournament_match_ready", "tournament_champion",
    // Private activities (migration 0150): being added to someone's private
    // activity/game — only ever sent to the people involved, and only when the
    // organizer opted in. Off by default; opt into the push in Profile.
    "private_activity_invite",
    // Admin test notification (migration 0156): an admin deliberately pinging
    // ONE specific member to check their notifications are working. An
    // OVERRIDE push (handled below) — the whole point is testing the push
    // pipeline for that person, not respecting their per-category picks.
    "admin_test",
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
    const pushTypes = (prof && prof.push_types) || [];
    if (n.type === "help_urgent" || n.type === "admin_test") {
      // Override: buzz anyone whose phone push is ON (push_types non-empty = the
      // master switch is on). help_urgent is an emergency to everyone; admin_test
      // is an admin deliberately testing one member's notifications — neither
      // requires per-category opt-in. Push OFF still gets nothing.
      if (pushTypes.length === 0) return;
    } else if (!pushTypes.includes(n.type)) {
      return;
    }

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

  // A new member just verified their email (profiles.joined_at was just stamped
  // by the on_auth_user_email_confirmed trigger — migration 0054). Tell every
  // admin who hasn't opted out (notify_new_members, default on, migration 0026)
  // who joined and when. Email comes from the GoTrue admin API (service_role).
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
    // App Review account: never announce it to admins (matches the SQL guard in
    // notif_on_new_member). Keeps the reviewer login invisible to the family.
    if (email && email.toLowerCase() === "appreview@muskellungelakeresort.com") {
      console.log("[push] skipping App Review account");
      return;
    }
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

  // A profiles row event means a *genuinely new* member ONLY when joined_at was
  // just stamped (OTP verified, migration 0054). We can't rely on e.old: profiles
  // uses the default REPLICA IDENTITY, so a realtime UPDATE's `old` carries only
  // the primary key (e.old.joined_at is undefined) — which made the previous
  // `!e.old.joined_at` guard true for EVERY profile edit / re-sign-in of an
  // existing member, so re-verifying an existing account falsely pushed "joined".
  // Instead we gate on joined_at being freshly set (within JOIN_FRESH_MS of now);
  // an existing member's joined_at is old, so it never re-notifies. handleNewMember's
  // once() dedupes the INSERT + UPDATE that can both accompany one verification.
  const JOIN_FRESH_MS = 10 * 60 * 1000;
  const maybeNewMember = (row) => {
    if (!row || !row.joined_at) return;
    // Sent via /admin/invite-link (migration 0085) — the inviting admin
    // already knows exactly who's joining, so skip the "new member" push.
    if (row.invited_via === "invite_link") return;
    const t = Date.parse(row.joined_at);
    if (!Number.isFinite(t) || Date.now() - t > JOIN_FRESH_MS) return;
    handleNewMember(row.id, row.display_name).catch((err) =>
      console.error("[push] new member error:", err && err.message),
    );
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
      .select("id, cabin_id, user_id, check_in, check_out, status, request_notify")
      .eq("id", id)
      .maybeSingle();
    if (!b || b.status !== "pending" || b.request_notify === false) return;

    const [cabinRes, reqRes, adminRes] = await Promise.all([
      sb.from("cabins").select("name, approver_user_id").eq("id", b.cabin_id).maybeSingle(),
      sb.from("profiles").select("display_name").eq("id", b.user_id).maybeSingle(),
      sb.from("profiles").select("id, notif_types").eq("is_admin", true),
    ]);
    const cabin = cabinRes.data ? cabinRes.data.name : "a cabin";
    const name = ((reqRes.data && reqRes.data.display_name) || "").trim() || "A member";
    const recipients = [...(adminRes.data || [])];
    // A place's designated, non-admin approver (migration 0114) — e.g. a
    // family member whose own house is bookable but who isn't an app admin —
    // also needs the push, since they won't see the admin queue at all.
    const approverId = cabinRes.data ? cabinRes.data.approver_user_id : null;
    if (approverId && !recipients.some((a) => a.id === approverId)) {
      const { data: approverRow } = await sb
        .from("profiles")
        .select("id, notif_types")
        .eq("id", approverId)
        .maybeSingle();
      if (approverRow) recipients.push(approverRow);
    }
    const targets = recipients
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
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "house_messages" }, (e) =>
      handleHouseMessage(e.new.id).catch((err) => console.error("[push] house msg error:", err && err.message)),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (e) =>
      handleAlert(e.new.id).catch((err) => console.error("[push] alert error:", err && err.message)),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (e) =>
      handleFeedNotification(e.new).catch((err) =>
        console.error("[push] feed notification error:", err && err.message),
      ),
    )
    // A new member's profile is stamped with joined_at at first verification —
    // which can land as an INSERT (no prior row) or an UPDATE (stub upgraded).
    // Route both through maybeNewMember, which fires only on a FRESH joined_at,
    // so an existing member re-signing in / editing their profile never re-notifies.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, (e) => maybeNewMember(e.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (e) => maybeNewMember(e.new))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "cabin_bookings" }, (e) =>
      handleCabinRequest(e.new.id).catch((err) => console.error("[push] cabin request error:", err && err.message)),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") console.log("[push] listening (committee + house chat + alerts + feed notifications + verified new members + cabin requests)");
    });
}

module.exports = { start };
