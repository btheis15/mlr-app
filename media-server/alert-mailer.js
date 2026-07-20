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
    // Nudge an approved requester with no room yet to pick one themselves
    // (migration 0106/0107) — only when the cabin actually uses named rooms;
    // a plain room-count cabin has nothing to pick.
    const needsRoomPick = approved && d.cabin_has_rooms && !d.room_names;
    const roomLine = d.room_names
      ? [["Room", escapeHtml(d.room_names)]]
      : [];
    const detailRows = [
      ["Cabin", escapeHtml(d.cabin_name)],
      ["Check-in", `${fmtFull(d.check_in)} <span style="color:#888">(from 4:00 PM)</span>`],
      ["Check-out", `${fmtFull(d.check_out)} <span style="color:#888">(by 11:00 AM)</span>`],
      ["Nights", String(n)],
      ["Guests", String(d.guests)],
      ...roomLine,
    ]
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#888;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`,
      )
      .join("");
    const roomPickNote = needsRoomPick
      ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f6f6f1;border-radius:10px;font-size:14px">🛏️ <strong>No room picked yet</strong> — open the app, find this stay under <strong>Cabin Bookings → Your requests</strong>, and tap <strong>Choose your room</strong> once you know which one you want.</p>`
      : "";

    const html = approved
      ? `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:19px;margin:0 0 2px"><strong>Your cabin stay is confirmed ✅</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(d.requester_name)}, you're all set — here are your details:</p>
<table style="border-collapse:collapse;font-size:14px;margin:0 0 4px">${detailRows}</table>
${d.notes ? `<p style="margin:12px 0 0;font-size:13px;color:#555">Your note: “${escapeHtml(d.notes)}”</p>` : ""}
${note}
${roomPickNote}
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
      ? `Your cabin stay is confirmed.\n\nCabin: ${d.cabin_name}\nCheck-in: ${fmtFull(d.check_in)} (from 4:00 PM)\nCheck-out: ${fmtFull(d.check_out)} (by 11:00 AM)\nNights: ${n}\nGuests: ${d.guests}${d.room_names ? `\nRoom: ${d.room_names}` : ""}${d.review_note ? `\n\nNote from the admin: ${d.review_note}` : ""}${needsRoomPick ? `\n\nNo room picked yet — open the app, find this stay under Cabin Bookings → Your requests, and tap Choose your room once you know which one you want.` : ""}\n\nView in the app: ${APP_URL}/request-stay\n\n— Muskellunge Lake Resort`
      : `Thanks for your cabin stay request for ${d.cabin_name} (${stay}). Unfortunately we weren't able to approve it this time.${d.review_note ? `\n\nNote from the admin: ${d.review_note}` : ""}\n\nQuestions or different dates? Reply to this email or reach out to an admin.\n\n— Muskellunge Lake Resort`;

    try {
      await transport.sendMail({ from: ALERT_FROM, to: d.requester_email, subject, text, html });
      console.log(`[mailer] cabin ${d.status} emailed to ${d.requester_email}`);
    } catch (e) {
      console.error("[mailer] cabin send failed:", e && e.message);
      await sb.from("cabin_bookings").update({ decision_email_sent_at: null }).eq("id", row.id); // let a retry pick it up
    }
  }

  // Email the requester when an admin edits an existing booking's dates/guests/
  // notes and opts in to notifying them (migration 0105) — distinct from the
  // approve/deny confirmation: an edit can happen any number of times, so it
  // claims by advancing edit_email_sent_at to match this edit's
  // edit_notify_requested_at rather than a one-shot boolean.
  async function handleCabinEdit(row) {
    if (!row || !row.edit_notify_requested_at) return;
    if (row.edit_email_sent_at && row.edit_email_sent_at >= row.edit_notify_requested_at) return;
    // Claim by advancing edit_email_sent_at to this edit's requested_at, only
    // if nobody else already claimed this exact edit (matching both
    // timestamps guards against a concurrent duplicate event for the same
    // edit; a later edit gets a newer requested_at and claims independently).
    const { data: claimed } = await sb
      .from("cabin_bookings")
      .update({ edit_email_sent_at: row.edit_notify_requested_at })
      .eq("id", row.id)
      .eq("edit_notify_requested_at", row.edit_notify_requested_at)
      .or(`edit_email_sent_at.is.null,edit_email_sent_at.neq.${row.edit_notify_requested_at}`)
      .select("id");
    if (!claimed || claimed.length === 0) return; // already handled

    const { data: info, error } = await sb.rpc("cabin_booking_notification", { p_booking: row.id });
    const d = (info || [])[0];
    if (error || !d || !d.requester_email) {
      console.log(`[mailer] cabin edit ${row.id}: no recipient (${error ? error.message : "no email"})`);
      return;
    }

    const stay = `${fmtFull(d.check_in)} → ${fmtFull(d.check_out)}`;
    const n = nightsBetween(d.check_in, d.check_out);
    const needsRoomPick = d.cabin_has_rooms && !d.room_names;
    const detailRows = [
      ["Cabin", escapeHtml(d.cabin_name)],
      ["Check-in", `${fmtFull(d.check_in)} <span style="color:#888">(from 4:00 PM)</span>`],
      ["Check-out", `${fmtFull(d.check_out)} <span style="color:#888">(by 11:00 AM)</span>`],
      ["Nights", String(n)],
      ["Guests", String(d.guests)],
      ...(d.room_names ? [["Room", escapeHtml(d.room_names)]] : []),
    ]
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#888;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`,
      )
      .join("");
    const roomPickNote = needsRoomPick
      ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f6f6f1;border-radius:10px;font-size:14px">🛏️ <strong>No room picked yet</strong> — open the app, find this stay under <strong>Cabin Bookings → Your requests</strong>, and tap <strong>Choose your room</strong> once you know which one you want.</p>`
      : "";
    const subject = `Your cabin stay was updated — ${d.cabin_name}`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:18px;margin:0 0 2px"><strong>Your cabin stay was updated</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(d.requester_name)}, an admin made a change to your ${escapeHtml(d.cabin_name)} stay. Here's the current state:</p>
<table style="border-collapse:collapse;font-size:14px;margin:0 0 4px">${detailRows}</table>
${d.notes ? `<p style="margin:12px 0 0;font-size:13px;color:#555">Notes: "${escapeHtml(d.notes)}"</p>` : ""}
${roomPickNote}
<p style="margin:20px 0 0"><a href="${APP_URL}/request-stay" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">View in the app →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">Muskellunge Lake Resort · Tomahawk, WI</p>
</div>`;
    const text = `Your cabin stay was updated.\n\nCabin: ${d.cabin_name}\nCheck-in: ${fmtFull(d.check_in)} (from 4:00 PM)\nCheck-out: ${fmtFull(d.check_out)} (by 11:00 AM)\nNights: ${n}\nGuests: ${d.guests}${d.room_names ? `\nRoom: ${d.room_names}` : ""}${d.notes ? `\n\nNotes: ${d.notes}` : ""}${needsRoomPick ? `\n\nNo room picked yet — open the app, find this stay under Cabin Bookings → Your requests, and tap Choose your room once you know which one you want.` : ""}\n\nView in the app: ${APP_URL}/request-stay\n\n— Muskellunge Lake Resort`;

    try {
      await transport.sendMail({ from: ALERT_FROM, to: d.requester_email, subject, text, html });
      console.log(`[mailer] cabin edit emailed to ${d.requester_email} (stay: ${stay})`);
    } catch (e) {
      console.error("[mailer] cabin edit send failed:", e && e.message);
      await sb.from("cabin_bookings").update({ edit_email_sent_at: null }).eq("id", row.id); // let a retry pick it up
    }
  }

  // Email the requester when their cabin stay is cancelled — only when
  // someone else (an admin) cancelled it; cancel_cabin_stay pre-stamps
  // cancel_email_sent_at itself when the requester cancels their own booking
  // or p_notify was false, so this only ever fires for the "admin cancelled
  // it for them" case (migration 0109).
  async function handleCabinCancel(row) {
    if (!row || row.status !== "cancelled" || row.cancel_email_sent_at) return;
    const { data: claimed } = await sb
      .from("cabin_bookings")
      .update({ cancel_email_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("cancel_email_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) return; // already handled

    const { data: info, error } = await sb.rpc("cabin_booking_notification", { p_booking: row.id });
    const d = (info || [])[0];
    if (error || !d || !d.requester_email) {
      console.log(`[mailer] cabin cancel ${row.id}: no recipient (${error ? error.message : "no email"})`);
      return;
    }

    const stay = `${fmtFull(d.check_in)} → ${fmtFull(d.check_out)}`;
    const subject = `Your cabin stay was cancelled — ${d.cabin_name}`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:18px;margin:0 0 2px"><strong>Your cabin stay was cancelled</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(d.requester_name)}, your ${escapeHtml(d.cabin_name)} stay (${stay}) has been cancelled.</p>
<p style="margin:16px 0 0;font-size:14px">Questions, or want to request different dates? Reply to this email or reach out to an admin in the app.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">Muskellunge Lake Resort · Tomahawk, WI</p>
</div>`;
    const text = `Your cabin stay was cancelled.\n\nCabin: ${d.cabin_name}\nDates: ${stay}\n\nQuestions or want different dates? Reply to this email or reach out to an admin.\n\n— Muskellunge Lake Resort`;

    try {
      await transport.sendMail({ from: ALERT_FROM, to: d.requester_email, subject, text, html });
      console.log(`[mailer] cabin cancel emailed to ${d.requester_email} (stay: ${stay})`);
    } catch (e) {
      console.error("[mailer] cabin cancel send failed:", e && e.message);
      await sb.from("cabin_bookings").update({ cancel_email_sent_at: null }).eq("id", row.id); // let a retry pick it up
    }
  }

  // Email room members when a meeting is proposed with "Also email everyone" on
  // (migration 0117) — mirrors the announcements claim/retry pattern. The
  // meeting_proposal_email RPC (service-role) returns the title, an in-app
  // deep-link, and the emails of room members with email_alerts on (minus the
  // organizer). BCC keeps addresses private; the button opens the app straight
  // into the voting UI.
  async function handleMeeting(row) {
    if (!row || !row.notify_email || row.proposal_email_sent_at) return;
    const { data: claimed } = await sb
      .from("meetings")
      .update({ proposal_email_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("proposal_email_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) return; // already handled

    const { data: info, error } = await sb.rpc("meeting_proposal_email", { p_meeting: row.id });
    const d = (info || [])[0];
    if (error || !d) {
      console.error("[mailer] meeting_proposal_email error:", error ? error.message : "no data");
      await sb.from("meetings").update({ proposal_email_sent_at: null }).eq("id", row.id); // retry
      return;
    }
    const emails = (d.emails || []).filter(Boolean);
    if (emails.length === 0) {
      console.log(`[mailer] meeting ${row.id}: no opted-in recipients`);
      return; // leave it claimed — nobody to email
    }
    const link = `${APP_URL}${d.url || ""}`;
    const subject = `📅 A meeting is being planned — ${d.title}`;
    const text = `A meeting is being planned: ${d.title}\n\nMark which times work for you so we can pick the best one:\n${link}\n\n— Muskellunge Lake Resort\n(You're getting this because email alerts are on in your profile.)`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:19px;margin:0 0 2px"><strong>📅 A meeting is being planned</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">${escapeHtml(d.title)}</p>
<p style="margin:0 0 16px;font-size:15px">Mark which times work for you, right in the app, so we can lock in the one that works for the most people.</p>
<p style="margin:0 0 4px"><a href="${link}" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">Mark when you're free →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">You're getting this because email alerts are on in your MLR profile.</p>
</div>`;
    try {
      await transport.sendMail({ from: ALERT_FROM, to: ALERT_FROM, bcc: emails, subject, text, html });
      console.log(`[mailer] meeting ${row.id} emailed to ${emails.length} member(s)`);
    } catch (e) {
      console.error("[mailer] meeting send failed:", e && e.message);
      await sb.from("meetings").update({ proposal_email_sent_at: null }).eq("id", row.id); // retry
    }
  }

  // Email the whole group when a meeting is confirmed to a time WITH a Meet link
  // (migration 0118). Always sends on confirmation (respecting email_alerts) —
  // it's the payoff — a polished email describing the meeting + a big "Join the
  // Google Meet" button. Claims confirm_email_sent_at; gated on meet_url so a
  // linkless finalize waits until the link is added, then fires with it.
  async function handleMeetingConfirmed(row) {
    if (!row || row.status !== "scheduled" || !row.meet_url || row.confirm_email_sent_at) return;
    const { data: claimed } = await sb
      .from("meetings")
      .update({ confirm_email_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("confirm_email_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) return; // already handled

    const { data: info, error } = await sb.rpc("meeting_confirmed_email", { p_meeting: row.id });
    const d = (info || [])[0];
    if (error || !d) {
      console.error("[mailer] meeting_confirmed_email error:", error ? error.message : "no data");
      await sb.from("meetings").update({ confirm_email_sent_at: null }).eq("id", row.id); // retry
      return;
    }
    const emails = (d.emails || []).filter(Boolean);
    if (emails.length === 0) {
      console.log(`[mailer] meeting ${row.id} confirmed: no opted-in recipients`);
      return;
    }
    const meet = d.meet_url;
    const appLink = `${APP_URL}${d.url || ""}`;
    const subject = `✅ Meeting confirmed — ${d.title}`;
    const text = `Meeting confirmed: ${d.title}\n\nWhen: ${d.when_label}\n${d.description ? `\nWhat it's about: ${d.description}\n` : ""}\nJoin the Google Meet: ${meet}\n\n(Or open it in the app: ${appLink})\n\n— Muskellunge Lake Resort`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:19px;margin:0 0 2px"><strong>✅ Your meeting is confirmed</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">Muskellunge Lake Resort</p>
<p style="margin:0 0 14px;font-size:15px">A time has been set for <strong>${escapeHtml(d.title)}</strong>. Here are the details:</p>
<table style="border-collapse:collapse;font-size:14px;margin:0 0 4px">
<tr><td style="padding:4px 16px 4px 0;color:#888;white-space:nowrap;vertical-align:top">When</td><td style="padding:4px 0"><strong>${escapeHtml(d.when_label)}</strong></td></tr>
${d.description ? `<tr><td style="padding:4px 16px 4px 0;color:#888;white-space:nowrap;vertical-align:top">About</td><td style="padding:4px 0">${escapeHtml(d.description)}</td></tr>` : ""}
</table>
<p style="margin:20px 0 6px"><a href="${meet}" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:10px;font-size:15px;font-weight:600">Join the Google Meet →</a></p>
<p style="margin:0 0 0;font-size:13px;color:#888">Link: <a href="${meet}" style="color:#15503a">${escapeHtml(meet)}</a></p>
<p style="margin:16px 0 0;font-size:13px"><a href="${appLink}" style="color:#15503a">Open it in the app →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">You're getting this because email alerts are on in your MLR profile.</p>
</div>`;
    try {
      await transport.sendMail({ from: ALERT_FROM, to: ALERT_FROM, bcc: emails, subject, text, html });
      console.log(`[mailer] meeting ${row.id} confirmation emailed to ${emails.length} member(s)`);
    } catch (e) {
      console.error("[mailer] meeting confirm send failed:", e && e.message);
      await sb.from("meetings").update({ confirm_email_sent_at: null }).eq("id", row.id); // retry
    }
  }

  // Email the current/upcoming guests of a place when its approver/admin sends a
  // note with "Also email them" on (migration 0120). Claims email_sent_at; the
  // cabin_message_recipients RPC returns the subject/body/place + guest emails
  // (approved, not-yet-ended stays, email_alerts on).
  async function handleCabinMessage(row) {
    if (!row || !row.notify_email || row.email_sent_at) return;
    const { data: claimed } = await sb
      .from("cabin_messages")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("email_sent_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) return; // already handled

    const { data: info, error } = await sb.rpc("cabin_message_recipients", { p_message: row.id });
    const d = (info || [])[0];
    if (error || !d) {
      console.error("[mailer] cabin_message_recipients error:", error ? error.message : "no data");
      await sb.from("cabin_messages").update({ email_sent_at: null }).eq("id", row.id); // retry
      return;
    }
    const emails = (d.emails || []).filter(Boolean);
    if (emails.length === 0) {
      console.log(`[mailer] cabin_message ${row.id}: no opted-in guests`);
      return;
    }
    const place = d.cabin_name || "your stay";
    const subject = `🏡 ${place}${d.subject ? ` — ${d.subject}` : " — a note about your stay"}`;
    const text = `${d.subject ? d.subject + "\n\n" : ""}${d.body}\n\n— ${place}, Muskellunge Lake Resort`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:520px">
<p style="font-size:18px;margin:0 0 2px"><strong>${escapeHtml(place)}</strong></p>
<p style="margin:0 0 16px;color:#15503a;font-weight:600">A note about your stay</p>
${d.subject ? `<p style="margin:0 0 10px;font-size:15px"><strong>${escapeHtml(d.subject)}</strong></p>` : ""}
<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap">${escapeHtml(d.body)}</p>
<p style="margin:16px 0 0"><a href="${APP_URL}/request-stay" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">Open the app →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px">
<p style="color:#888;font-size:12px;margin:0">You're getting this because you have an upcoming stay at ${escapeHtml(place)} and email alerts are on in your MLR profile.</p>
</div>`;
    try {
      await transport.sendMail({ from: ALERT_FROM, to: ALERT_FROM, bcc: emails, subject, text, html });
      console.log(`[mailer] cabin_message ${row.id} emailed to ${emails.length} guest(s)`);
    } catch (e) {
      console.error("[mailer] cabin_message send failed:", e && e.message);
      await sb.from("cabin_messages").update({ email_sent_at: null }).eq("id", row.id); // retry
    }
  }

  // Sweep everything unsent — alerts + cabin decisions/edits/cancellations.
  // Runs on startup AND on a recurring timer (see below), since realtime can
  // silently drop (CHANNEL_ERROR/TIMED_OUT) without ever recovering on its
  // own; the sweep is what actually guarantees a missed event still sends,
  // instead of sitting stuck until someone notices and restarts the mini.
  async function sweep() {
    const { data: pending } = await sb
      .from("announcements")
      .select("id, title, body, severity, notify_email, email_sent_at, created_at, email_audience")
      .is("email_sent_at", null)
      .eq("notify_email", true)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of pending || []) await handle(row);

    const { data: cabinPending } = await sb
      .from("cabin_bookings")
      .select("id, status, decision_email_sent_at, reviewed_at")
      .in("status", ["approved", "denied"])
      .is("decision_email_sent_at", null)
      .order("reviewed_at", { ascending: false })
      .limit(10);
    for (const row of cabinPending || []) await handleCabinDecision(row);

    const { data: editPending } = await sb
      .from("cabin_bookings")
      .select("id, edit_notify_requested_at, edit_email_sent_at")
      .not("edit_notify_requested_at", "is", null)
      .order("edit_notify_requested_at", { ascending: false })
      .limit(10);
    for (const row of editPending || []) await handleCabinEdit(row);

    const { data: cancelPending } = await sb
      .from("cabin_bookings")
      .select("id, status, cancel_email_sent_at")
      .eq("status", "cancelled")
      .is("cancel_email_sent_at", null)
      .order("updated_at", { ascending: false })
      .limit(10);
    for (const row of cancelPending || []) await handleCabinCancel(row);

    const { data: meetingPending } = await sb
      .from("meetings")
      .select("id, notify_email, proposal_email_sent_at, created_at")
      .eq("notify_email", true)
      .is("proposal_email_sent_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of meetingPending || []) await handleMeeting(row);

    const { data: confirmPending } = await sb
      .from("meetings")
      .select("id, status, meet_url, confirm_email_sent_at, finalized_at")
      .eq("status", "scheduled")
      .not("meet_url", "is", null)
      .is("confirm_email_sent_at", null)
      .order("finalized_at", { ascending: false })
      .limit(10);
    for (const row of confirmPending || []) await handleMeetingConfirmed(row);

    const { data: cabinMsgPending } = await sb
      .from("cabin_messages")
      .select("id, notify_email, email_sent_at, created_at")
      .eq("notify_email", true)
      .is("email_sent_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of cabinMsgPending || []) await handleCabinMessage(row);
  }
  await sweep();
  setInterval(() => sweep().catch((e) => console.error("[mailer] sweep error:", e && e.message)), 3 * 60 * 1000);

  // Live: email on each new alert + each cabin stay decision/edit/cancel.
  // Resubscribes on drop (CHANNEL_ERROR/TIMED_OUT/CLOSED) instead of leaving
  // the connection dead — the periodic sweep above is the real safety net,
  // but reconnecting keeps the common case near-instant instead of waiting
  // up to 3 minutes for the next sweep.
  let realtimeChannel = null;
  let reconnecting = false;
  function subscribeRealtime() {
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    realtimeChannel = sb.channel("alert-mailer")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, (payload) => {
        handle(payload.new).catch((e) => console.error("[mailer] handle error:", e && e.message));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cabin_bookings" }, (payload) => {
        handleCabinDecision(payload.new).catch((e) => console.error("[mailer] cabin handle error:", e && e.message));
        handleCabinEdit(payload.new).catch((e) => console.error("[mailer] cabin edit handle error:", e && e.message));
        handleCabinCancel(payload.new).catch((e) => console.error("[mailer] cabin cancel handle error:", e && e.message));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "meetings" }, (payload) => {
        handleMeeting(payload.new).catch((e) => console.error("[mailer] meeting handle error:", e && e.message));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "meetings" }, (payload) => {
        handleMeetingConfirmed(payload.new).catch((e) => console.error("[mailer] meeting confirm handle error:", e && e.message));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cabin_messages" }, (payload) => {
        handleCabinMessage(payload.new).catch((e) => console.error("[mailer] cabin message handle error:", e && e.message));
      })
      .subscribe((status) => {
        console.log("[mailer] realtime:", status);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!reconnecting) {
            reconnecting = true;
            setTimeout(() => { reconnecting = false; subscribeRealtime(); }, 5000);
          }
        }
      });
  }
  subscribeRealtime();
  console.log("[mailer] watching for alerts + cabin stay decisions/edits/cancellations + meeting proposals to email");
}

module.exports = { start, enabled };
