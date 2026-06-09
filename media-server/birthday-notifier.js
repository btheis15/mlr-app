// Birthday notifications — runs on the mini alongside push-sender + mailer.
//
// Once a day (after BIRTHDAY_HOUR, in BIRTHDAY_TZ) it finds members whose
// birthday is today and pushes everyone who opted into 'birthdays' (push_types):
//   "🎂 Jane's birthday — Jane is turning 42 today! Tap to text or call them."
// Tapping opens Jane's contact card (?member=<id>) with Call / Text buttons.
//
// DORMANT unless the same env as push-sender is set (SERVICE_KEY + VAPID keys).
// Optional config:
//   BIRTHDAY_HOUR   local hour to send (0–23; default 8)
//   BIRTHDAY_TZ     IANA timezone for "today" + the hour (default America/Chicago)
//
// Scheduling: checks hourly and fires once per local day after BIRTHDAY_HOUR.
// The "already sent today" marker is PERSISTED to disk (.birthday-state), so a
// same-day restart of the media-server does NOT re-send — without that, every
// deploy/restart re-fired the day's birthday pushes (the in-memory marker reset
// and the startup catch-up ran again). If the mini was genuinely down at the
// send hour, the catch-up still delivers once when it comes back, because the
// marker won't yet hold today's date.

const fs = require("fs");
const path = require("path");

const APP_URL = (process.env.APP_URL || "https://mlr-app-omega.vercel.app").replace(/\/+$/, "");
const ICON = `${APP_URL}/icon-192.png`;
// Survives restarts (sits next to this file on the mini, gitignored).
const STATE_FILE = path.join(__dirname, ".birthday-state");
const TZ = process.env.BIRTHDAY_TZ || "America/Chicago";
const SEND_HOUR = Math.max(0, Math.min(23, Number(process.env.BIRTHDAY_HOUR || 8)));

// The wall-clock parts of `date` in the configured timezone.
function tzParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const p = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== "literal") p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) % 24 };
}

async function start() {
  const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const VAPID_PUBLIC = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || "").trim();
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:alerts@muskellungelakeresort.com";

  if (!SUPABASE_URL || !SERVICE_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.log("[birthday] dormant (needs VAPID keys + SUPABASE_SERVICE_ROLE_KEY, same as push)");
    return;
  }
  let webpush, createClient;
  try {
    webpush = require("web-push");
    ({ createClient } = require("@supabase/supabase-js"));
  } catch (e) {
    console.error("[birthday] missing deps — run `npm install` in media-server:", e && e.message);
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const sendToUser = async (userId, payload) => {
    const { data: subs } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
    let ok = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        ok++;
      } catch (e) {
        const code = e && e.statusCode;
        if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
    return ok;
  };

  const run = async (now) => {
    const mm = String(now.m).padStart(2, "0");
    const dd = String(now.d).padStart(2, "0");
    const { data: people, error } = await sb
      .from("profiles")
      .select("id, display_name, birthday")
      .not("birthday", "is", null);
    if (error) { console.error("[birthday] query error:", error.message); return; }
    const isLeap = (now.y % 4 === 0 && now.y % 100 !== 0) || now.y % 400 === 0;
    const todays = (people || []).filter((p) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(p.birthday || ""));
      if (!m) return false;
      if (m[2] === mm && m[3] === dd) return true;
      // Feb-29 birthdays in a non-leap year → celebrate on Feb 28 (never skipped).
      return !isLeap && m[2] === "02" && m[3] === "29" && mm === "02" && dd === "28";
    });
    if (!todays.length) { console.log(`[birthday] none today (${mm}-${dd})`); return; }

    const { data: optedIn } = await sb.from("profiles").select("id").contains("push_types", ["birthdays"]);
    const recipientIds = (optedIn || []).map((p) => p.id);

    for (const person of todays) {
      const name = (person.display_name || "Someone").trim();
      const bm = /^(\d{4})-/.exec(String(person.birthday));
      const age = bm ? now.y - Number(bm[1]) : null; // it's their birthday today → no adjust
      const body = age != null
        ? `${name} is turning ${age} today! Tap to text or call them. 🎉`
        : `It's ${name}'s birthday! Tap to text or call them. 🎉`;
      const payload = {
        title: `🎂 ${name}'s birthday`,
        body,
        icon: ICON,
        badge: ICON,
        tag: `birthday-${person.id}-${now.y}`,
        url: `${APP_URL}/?member=${person.id}`,
      };
      let sent = 0;
      for (const uid of recipientIds) {
        if (uid === person.id) continue; // don't notify the birthday person about their own
        sent += (await sendToUser(uid, payload)) > 0 ? 1 : 0;
      }
      console.log(`[birthday] ${name} (${mm}-${dd}): notified ${sent}`);
    }
  };

  // local YYYY-MM-DD we last ran for — restored from disk so a same-day restart
  // doesn't re-send (best-effort: a missing/unreadable file just means "never").
  let lastSent = null;
  try { lastSent = (fs.readFileSync(STATE_FILE, "utf8").trim() || null); } catch { /* none yet */ }

  const tick = async () => {
    try {
      const now = tzParts(new Date());
      const today = `${now.y}-${String(now.m).padStart(2, "0")}-${String(now.d).padStart(2, "0")}`;
      if (now.hour >= SEND_HOUR && lastSent !== today) {
        // Persist BEFORE sending so a crash/restart mid-send can't re-trigger the
        // whole batch on startup.
        lastSent = today;
        try { fs.writeFileSync(STATE_FILE, today); } catch (e) { console.error("[birthday] state write failed:", e && e.message); }
        await run(now);
      }
    } catch (e) {
      console.error("[birthday] tick error:", e && e.message);
    }
  };

  await tick(); // catch up on startup
  setInterval(tick, 60 * 60 * 1000); // hourly
  console.log(`[birthday] watching (sends ~${SEND_HOUR}:00 ${TZ})`);
}

module.exports = { start };
