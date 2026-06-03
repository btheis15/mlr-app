// Emails opted-in members when a broadcast alert is posted (an `announcements`
// row, migration 0015). Runs on the always-on mini, alongside the media server.
//
// DORMANT unless these env vars are set (so nothing happens until you opt in):
//   SUPABASE_URL                (already set for uploads)
//   SUPABASE_SERVICE_ROLE_KEY   ⚠️ powerful — bypasses RLS to read member emails.
//                                Keep it ONLY in this mini .env; never in the app/client.
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   any SMTP provider — e.g. the
//                                SAME creds you set up in Supabase Auth → SMTP.
//                                (SMTP_PORT 465 ⇒ secure; or set SMTP_SECURE=true.)
//     — or, as a shortcut for Gmail: GMAIL_USER + GMAIL_APP_PASSWORD.
//   ALERT_FROM (optional)       the From address (match what your SMTP allows),
//                                e.g. "Muskellunge Lake Resort <alerts@yourdomain>"
//   APP_URL (optional)          link back to the app in the email
//
// It subscribes to new alerts via Supabase Realtime and also sweeps any recent
// unsent ones on startup. It "claims" each alert by stamping email_sent_at
// (atomic: only the row where it's still null), so an alert is never emailed
// twice — even across reconnects/restarts.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// SMTP — works with ANY provider (reuse the same creds you set up in Supabase
// Auth → SMTP). Generic SMTP_* wins; GMAIL_* is a convenience shortcut.
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || process.env.GMAIL_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "";
const USE_GMAIL = !SMTP_HOST && Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const ALERT_FROM = process.env.ALERT_FROM || (SMTP_USER ? `Muskellunge Lake Resort <${SMTP_USER}>` : "");
const APP_URL = (process.env.APP_URL || "https://mlr-app-omega.vercel.app").replace(/\/+$/, "");

function enabled() {
  return Boolean(SUPABASE_URL && SERVICE_KEY && SMTP_USER && SMTP_PASS && (SMTP_HOST || USE_GMAIL));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function start() {
  if (!enabled()) {
    console.log("[mailer] disabled — set SUPABASE_SERVICE_ROLE_KEY + SMTP_HOST/SMTP_USER/SMTP_PASS (or GMAIL_USER/GMAIL_APP_PASSWORD) to email alerts.");
    return;
  }
  const { createClient } = require("@supabase/supabase-js");
  const nodemailer = require("nodemailer");
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const transport = USE_GMAIL
    ? nodemailer.createTransport({ service: "gmail", auth: { user: SMTP_USER, pass: SMTP_PASS } })
    : nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  try {
    await transport.verify();
    console.log(`[mailer] SMTP ready (${USE_GMAIL ? "gmail" : SMTP_HOST}:${USE_GMAIL ? 465 : SMTP_PORT})`);
  } catch (e) {
    console.error("[mailer] SMTP verify failed (check SMTP creds):", e && e.message);
    return;
  }

  async function handle(row) {
    if (!row || !row.notify_email || row.email_sent_at) return;
    // Atomically claim it: succeed only if email_sent_at is still null.
    const { data: claimed } = await sb
      .from("announcements")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("email_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) return; // already handled
    const { data: recips, error } = await sb.rpc("alert_recipients");
    if (error) {
      console.error("[mailer] alert_recipients error:", error.message);
      await sb.from("announcements").update({ email_sent_at: null }).eq("id", row.id);
      return;
    }
    const emails = (recips || []).map((r) => r.email).filter(Boolean);
    if (emails.length === 0) {
      console.log(`[mailer] alert ${row.id}: no opted-in recipients`);
      return;
    }
    const subject = `${row.severity === "alert" ? "📣 " : ""}${row.title}`;
    const text = `${row.title}\n\n${row.body || ""}\n\nOpen the app: ${APP_URL}\n\n— Muskellunge Lake Resort\n(You're getting this because email alerts are on in your profile.)`;
    const html = `<p style="font-size:16px"><strong>${escapeHtml(row.title)}</strong></p>${row.body ? `<p>${escapeHtml(row.body)}</p>` : ""}<p><a href="${APP_URL}">Open the app →</a></p><hr style="border:none;border-top:1px solid #eee"><p style="color:#888;font-size:12px">You're getting this because email alerts are on in your MLR profile.</p>`;
    try {
      // BCC keeps everyone's address private; To is the resort address itself.
      await transport.sendMail({ from: ALERT_FROM, to: ALERT_FROM, bcc: emails, subject, text, html });
      console.log(`[mailer] alert ${row.id} emailed to ${emails.length} member(s)`);
    } catch (e) {
      console.error("[mailer] send failed:", e && e.message);
      await sb.from("announcements").update({ email_sent_at: null }).eq("id", row.id); // let a retry pick it up
    }
  }

  // Sweep recent unsent alerts (one may have been posted while we were down).
  const { data: pending } = await sb
    .from("announcements")
    .select("id, title, body, severity, notify_email, email_sent_at, created_at")
    .is("email_sent_at", null)
    .eq("notify_email", true)
    .order("created_at", { ascending: false })
    .limit(10);
  for (const row of pending || []) await handle(row);

  // Live: email on each new alert.
  sb.channel("alert-mailer")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (payload) => {
      handle(payload.new).catch((e) => console.error("[mailer] handle error:", e && e.message));
    })
    .subscribe((status) => console.log("[mailer] realtime:", status));
  console.log("[mailer] watching for alerts to email");
}

module.exports = { start, enabled };
