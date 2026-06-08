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

// Date-only formatting for the cabin emails. Forced to UTC so a date never
// drifts a day on a negative-offset clock (the values are date-only strings).
function fmtFull(d) {
  if (!d) return "";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}
function nightsBetween(a, b) {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.max(0, Math.round(ms / 86400000));
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
    let { data: recips, error } = await sb.rpc("alert_recipients", { audience: row.email_audience || "all" });
    if (error) ({ data: recips, error } = await sb.rpc("alert_recipients")); // pre-0017: no audience param → everyone
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

  // Email the requester when an admin approves or denies a cabin stay. Claims
  // the row atomically (decision_email_sent_at), then pulls the details +
  // requester email from the service-role-only RPC (migration 0032). Sent to the
  // one person (To, not BCC). Mirrors the announcements claim/retry pattern.
  async function handleCabinDecision(row) {
    if (!row || (row.status !== "approved" && row.status !== "denied") || row.decision_email_sent_at) return;
    const { data: claimed } = await sb
      .from("cabin_bookings")
      .update({ decision_email_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("decision_email_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) return; // already handled

    const { data: info, error } = await sb.rpc("cabin_booking_notification", { p_booking: row.id });
    const d = (info || [])[0];
    if (error || !d || !d.requester_email) {
      console.log(`[mailer] cabin ${row.id}: no recipient (${error ? error.message : "no email"})`);
      return; // leave it claimed — nothing to send
    }

    const approved = d.status === "approved";
    const stay = `${fmtFull(d.check_in)} → ${fmtFull(d.check_out)}`;
    const n = nightsBetween(d.check_in, d.check_out);
    const subject = approved
      ? `✅ Cabin stay confirmed — ${d.cabin_name}`
      : `Your cabin stay request — ${d.cabin_name}`;

    const note = d.review_note
      ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f6f6f1;border-radius:10px;font-size:14px"><strong>Note from the admin:</strong> ${escapeHtml(d.review_note)}</p>`
      : "";
    const detailRows = [
      ["Cabin", escapeHtml(d.cabin_name)],
      ["Check-in", `${fmtFull(d.check_in)} <span style="color:#888">(from 4:00 PM)</span>`],
      ["Check-out", `${fmtFull(d.check_out)} <span style="color:#888">(by 11:00 AM)</span>`],
      ["Nights", String(n)],
      ["Guests", String(d.guests)],
    ]
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#888;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`,
      )
      .join("");

    const html = approved
      ? `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:19px;margin:0 0 2px"><strong>Your cabin stay is confirmed ✅</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(d.requester_name)}, you're all set — here are your details:</p>
<table style="border-collapse:collapse;font-size:14px;margin:0 0 4px">${detailRows}</table>
${d.notes ? `<p style="margin:12px 0 0;font-size:13px;color:#555">Your note: “${escapeHtml(d.notes)}”</p>` : ""}
${note}
<p style="margin:20px 0 0"><a href="${APP_URL}/request-stay" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">View in the app →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">Muskellunge Lake Resort · Muskellunge Lake, 5 mi from Tomahawk on Hwy 8, Tomahawk, WI</p>
</div>`
      : `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:18px;margin:0 0 2px"><strong>About your cabin stay request</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(d.requester_name)}, thanks for your request for <strong>${escapeHtml(d.cabin_name)}</strong> (${stay}). Unfortunately we weren't able to approve it this time.</p>
${note}
<p style="margin:16px 0 0;font-size:14px">Questions, or want to try different dates? Reply to this email or reach out to an admin in the app.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">Muskellunge Lake Resort · Tomahawk, WI</p>
</div>`;

    const text = approved
      ? `Your cabin stay is confirmed.\n\nCabin: ${d.cabin_name}\nCheck-in: ${fmtFull(d.check_in)} (from 4:00 PM)\nCheck-out: ${fmtFull(d.check_out)} (by 11:00 AM)\nNights: ${n}\nGuests: ${d.guests}${d.review_note ? `\n\nNote from the admin: ${d.review_note}` : ""}\n\nView in the app: ${APP_URL}/request-stay\n\n— Muskellunge Lake Resort`
      : `Thanks for your cabin stay request for ${d.cabin_name} (${stay}). Unfortunately we weren't able to approve it this time.${d.review_note ? `\n\nNote from the admin: ${d.review_note}` : ""}\n\nQuestions or different dates? Reply to this email or reach out to an admin.\n\n— Muskellunge Lake Resort`;

    try {
      await transport.sendMail({ from: ALERT_FROM, to: d.requester_email, subject, text, html });
      console.log(`[mailer] cabin ${d.status} emailed to ${d.requester_email}`);
    } catch (e) {
      console.error("[mailer] cabin send failed:", e && e.message);
      await sb.from("cabin_bookings").update({ decision_email_sent_at: null }).eq("id", row.id); // let a retry pick it up
    }
  }

  // Sweep recent unsent alerts (one may have been posted while we were down).
  const { data: pending } = await sb
    .from("announcements")
    .select("id, title, body, severity, notify_email, email_sent_at, created_at, email_audience")
    .is("email_sent_at", null)
    .eq("notify_email", true)
    .order("created_at", { ascending: false })
    .limit(10);
  for (const row of pending || []) await handle(row);

  // Sweep recent decided-but-unemailed cabin stays (decided while we were down).
  const { data: cabinPending } = await sb
    .from("cabin_bookings")
    .select("id, status, decision_email_sent_at, reviewed_at")
    .in("status", ["approved", "denied"])
    .is("decision_email_sent_at", null)
    .order("reviewed_at", { ascending: false })
    .limit(10);
  for (const row of cabinPending || []) await handleCabinDecision(row);

  // Live: email on each new alert + each cabin stay decision.
  sb.channel("alert-mailer")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (payload) => {
      handle(payload.new).catch((e) => console.error("[mailer] handle error:", e && e.message));
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cabin_bookings" }, (payload) => {
      handleCabinDecision(payload.new).catch((e) => console.error("[mailer] cabin handle error:", e && e.message));
    })
    .subscribe((status) => console.log("[mailer] realtime:", status));
  console.log("[mailer] watching for alerts + cabin stay decisions to email");
}

module.exports = { start, enabled };
