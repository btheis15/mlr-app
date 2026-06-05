// One-off self-test: send a push to every device a user has registered, using
// the same VAPID keys + payload shape as push-sender.js. Lets you verify push
// delivery on your own devices without asking someone else to post.
//
// Run from the media-server/ dir on the mini:
//   node scripts/send-test-push.js [userId] [type]
//   type = test (default) | chat | mention | alert   (just changes the copy)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

const APP_URL = (process.env.APP_URL || "https://mlr-app-omega.vercel.app").replace(/\/+$/, "");
const ICON = `${APP_URL}/icon-192.png`;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const VAPID_PUBLIC = (process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:alerts@muskellungelakeresort.com";

const userId = process.argv[2] || "1f6de479-c4d8-4830-a864-880d4a07a7de";
const type = process.argv[3] || "test";

const payloads = {
  test: { title: "📣 MLR push test", body: "If you see this, push works on this device! 🎉", url: "/" },
  chat: { title: "🔧 Resort Maintenance", body: "Brian: this is what a committee chat push looks like 📷", url: "/posts?c=resort-maintenance" },
  mention: { title: "🔧 Resort Maintenance", body: "Brian mentioned you in a message", url: "/posts?c=resort-maintenance" },
  alert: { title: "📣 Test Alert", body: "This is what a broadcast alert push looks like.", url: "/" },
};

(async () => {
  if (!SERVICE_KEY || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("Missing env (SERVICE_ROLE / VAPID). Run from media-server/ on the mini.");
    process.exit(1);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: subs, error } = await sb
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, user_agent")
    .eq("user_id", userId);
  if (error) { console.error("DB error:", error.message); process.exit(1); }
  if (!subs || !subs.length) { console.error("No subscriptions for user", userId); process.exit(1); }

  const p = payloads[type] || payloads.test;
  const payload = JSON.stringify({ title: p.title, body: p.body, icon: ICON, badge: ICON, tag: "mlr-test-" + type, url: `${APP_URL}${p.url}` });

  let ok = 0, fail = 0;
  for (const s of subs) {
    const ua = s.user_agent || "";
    const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Macintosh/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : "device";
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      console.log(`  sent OK  -> ${device}`); ok++;
    } catch (e) {
      console.log(`  FAILED   -> ${device}: ${e.statusCode || "?"} ${e.message}`); fail++;
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        console.log(`    (pruned dead subscription)`);
      }
    }
  }
  console.log(`done: ${ok} sent, ${fail} failed (type=${type})`);
  process.exit(fail && !ok ? 1 : 0);
})();
