// One-off: send a preview of the "cabin stay confirmed, no room picked yet"
// email to an arbitrary address, using fabricated example data — no DB writes.
// Usage: node scripts/send-test-room-email.js [toAddress]
require("dotenv").config();
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || process.env.GMAIL_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "";
const USE_GMAIL = !SMTP_HOST && Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const ALERT_FROM = process.env.ALERT_FROM || (SMTP_USER ? `Muskellunge Lake Resort <${SMTP_USER}>` : "");
const APP_URL = (process.env.APP_URL || "https://mlr-app-omega.vercel.app").replace(/\/+$/, "");

const TO = process.argv[2] || "brian.theis15@gmail.com";

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtFull(d) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}
function nightsBetween(a, b) {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

// Fabricated example — mirrors handleCabinDecision's "approved, has named
// rooms, none picked yet" branch (media-server/alert-mailer.js).
const d = {
  requester_name: "Sample Guest",
  cabin_name: "Red & White House",
  check_in: "2026-08-14",
  check_out: "2026-08-16",
  guests: 4,
  notes: "",
  review_note: "",
  room_names: null,
};

async function main() {
  if (!SMTP_USER || !SMTP_PASS || !(SMTP_HOST || USE_GMAIL)) {
    console.error("Missing SMTP env vars — check media-server/.env");
    process.exit(1);
  }
  const nodemailer = require("nodemailer");
  const transport = USE_GMAIL
    ? nodemailer.createTransport({ service: "gmail", auth: { user: SMTP_USER, pass: SMTP_PASS } })
    : nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });

  const stay = `${fmtFull(d.check_in)} → ${fmtFull(d.check_out)}`;
  const n = nightsBetween(d.check_in, d.check_out);
  const subject = `[TEST PREVIEW] ✅ Cabin stay confirmed — ${d.cabin_name}`;
  const needsRoomPick = true;
  const detailRows = [
    ["Cabin", escapeHtml(d.cabin_name)],
    ["Check-in", `${fmtFull(d.check_in)} <span style="color:#888">(from 4:00 PM)</span>`],
    ["Check-out", `${fmtFull(d.check_out)} <span style="color:#888">(by 11:00 AM)</span>`],
    ["Nights", String(n)],
    ["Guests", String(d.guests)],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#888;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`)
    .join("");
  const roomPickNote = needsRoomPick
    ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f6f6f1;border-radius:10px;font-size:14px">🛏️ <strong>No room picked yet</strong> — open the app, find this stay under <strong>Cabin Bookings → Your requests</strong>, and tap <strong>Choose your room</strong> once you know which one you want.</p>`
    : "";

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:19px;margin:0 0 2px"><strong>Your cabin stay is confirmed ✅</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(d.requester_name)}, you're all set — here are your details:</p>
<table style="border-collapse:collapse;font-size:14px;margin:0 0 4px">${detailRows}</table>
${roomPickNote}
<p style="margin:20px 0 0"><a href="${APP_URL}/request-stay" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">View in the app →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">Muskellunge Lake Resort · Muskellunge Lake, 5 mi from Tomahawk on Hwy 8, Tomahawk, WI</p>
</div>`;

  const text = `[TEST PREVIEW]\nYour cabin stay is confirmed.\n\nCabin: ${d.cabin_name}\nCheck-in: ${fmtFull(d.check_in)} (from 4:00 PM)\nCheck-out: ${fmtFull(d.check_out)} (by 11:00 AM)\nNights: ${n}\nGuests: ${d.guests}\n\nNo room picked yet — open the app, find this stay under Cabin Bookings → Your requests, and tap Choose your room once you know which one you want.\n\nView in the app: ${APP_URL}/request-stay\n\n— Muskellunge Lake Resort`;

  await transport.sendMail({ from: ALERT_FROM, to: TO, subject, text, html });
  console.log(`Sent test preview to ${TO}`);
}

main().catch((e) => {
  console.error("Send failed:", e && e.message);
  process.exit(1);
});
