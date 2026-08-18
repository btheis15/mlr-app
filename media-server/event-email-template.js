// The "email everyone about this event" template (migration 0190).
//
// Lives in its own module — rather than inline in alert-mailer.js like the older
// emails — so `scripts/preview-event-email.js` can render the EXACT same markup
// for review. If the preview and the real send could drift, the preview would be
// worthless; there is one builder and both call it.
//
// ONE BUILD PER BUCKET. The mailer sends a separate BCC'd email per audience:
// one per house that has items on the event (its people see the resort-wide list
// AND their own house's list), plus a "general" one for everybody else (the
// resort-wide list only, with no hint a house has its own). Pass that house as
// `bucket`; pass null for the general send. See the migration header for why.
//
// Only OPEN items ever reach here — the RPC filters completed ones out, since a
// done task is noise in an email about what still needs doing.

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const URGENCY_LABEL = {
  asap: "🔴 ASAP",
  this_year: "🟠 This year",
  next_year: "🟡 Next year",
  nice_to_have: "🟢 Nice to have",
};
const CUSTOM_URGENCY_DOT = {
  red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣", gray: "⚪",
};

/** Mirrors urgencyMeta() in lib/workItems.ts — a `custom` item carries its own
 *  wording + color instead of a fixed tier. */
function urgencyLabel(it) {
  if (!it || !it.urgency) return "";
  if (it.urgency !== "custom") return URGENCY_LABEL[it.urgency] || "";
  const dot = CUSTOM_URGENCY_DOT[it.customColor] || "⚪";
  return it.customLabel ? `${dot} ${it.customLabel}` : dot;
}

/** One task as its own card: the title, then ITS DETAILS, then urgency + headcount. */
function itemCard(it) {
  const meta = [
    urgencyLabel(it) ? `<span style="white-space:nowrap">${escapeHtml(urgencyLabel(it))}</span>` : "",
    it.peopleNeeded ? `<span style="white-space:nowrap">👥 ${Number(it.peopleNeeded)} needed</span>` : "",
  ]
    .filter(Boolean)
    .join('<span style="color:#c8cfcb"> · </span>');
  return `<tr><td style="padding:0 0 10px">
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0">
<tr><td style="padding:12px 15px;background:#f4f8f5;border-left:3px solid #15503a;border-radius:9px">
<div style="font-size:15.5px;font-weight:600;line-height:1.35;color:#14241c">${escapeHtml(it.title || "")}</div>
${it.notes ? `<div style="margin-top:5px;font-size:13.5px;color:#4a5a52;line-height:1.55;white-space:pre-wrap">${escapeHtml(it.notes)}</div>` : ""}
${meta ? `<div style="margin-top:7px;font-size:12px;color:#6b7b73">${meta}</div>` : ""}
</td></tr></table>
</td></tr>`;
}

function itemGroup(label, items, note) {
  if (!items || !items.length) return "";
  // `note` is the private-to-this-house explainer (see buildEventEmail) — a soft
  // parchment strip in italics, sitting between the heading and the cards so
  // it's impossible to miss but never louder than the tasks themselves.
  const noteHtml = note
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 10px"><tr><td style="padding:9px 12px;background:#fbf9f1;border:1px solid #efe8d5;border-radius:8px;font-size:12.5px;line-height:1.5;color:#6f6650;font-style:italic">${note}</td></tr></table>`
    : "";
  return `<p style="margin:0 0 9px;font-size:12.5px;font-weight:700;color:#14241c">${escapeHtml(label)}</p>
${noteHtml}<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px">${items.map(itemCard).join("")}</table>`;
}

/**
 * Build the subject + HTML + plain-text parts for ONE bucket.
 * @param {object} d       an `event_message_email()` row
 * @param {string} appUrl  base app URL (no trailing slash)
 * @param {object|null} bucket  the house this send is for ({name, emoji, items}),
 *                              or null for the general (resort-wide-only) send
 */
function buildEventEmail(d, appUrl, bucket = null) {
  const mlr = Array.isArray(d.mlr_items) ? d.mlr_items : [];
  const houseItems = bucket && Array.isArray(bucket.items) ? bucket.items : [];
  const emoji = d.event_emoji || "📅";
  const link = `${appUrl}/events?open=${encodeURIComponent(d.event_id)}`;
  const total = mlr.length + houseItems.length;

  const detailRows = [
    ...(d.event_when ? [["When", escapeHtml(d.event_when)]] : []),
    ...(d.event_location ? [["Where", escapeHtml(d.event_location)]] : []),
    ...(d.event_description ? [["About", escapeHtml(d.event_description)]] : []),
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:5px 18px 5px 0;color:#8b918d;white-space:nowrap;vertical-align:top;font-size:13px">${k}</td><td style="padding:5px 0;line-height:1.5">${v}</td></tr>`,
    )
    .join("");

  // Scope headings only when there are two groups to tell apart; a general send
  // with just the resort list doesn't need to be labelled twice.
  const showLabels = mlr.length > 0 && houseItems.length > 0;
  const houseName = bucket ? bucket.name || "your house" : "";
  // Spell the split out in the count line ("6 around the resort · 2 for MJT
  // House") rather than a bare total, so the reader can see at a glance which
  // tasks are theirs specifically — and so the different total from someone
  // else's copy is self-explaining.
  const countLine = showLabels
    ? `${mlr.length} around the resort · ${houseItems.length} for ${escapeHtml(houseName)}`
    : `${total} task${total === 1 ? "" : "s"} for this weekend`;
  // Why this reader's copy differs from everyone else's. A house's tasks are
  // private to that house (0066/0189), so its people are the only ones who see
  // this section — say so plainly here instead of letting someone discover it by
  // comparing emails with a cousin.
  const houseNote = houseItems.length
    ? `🔒 This part is only in ${escapeHtml(houseName)}&rsquo;s copy of this email — everyone else got the same note without these tasks.`
    : "";
  const workSection = total
    ? `<div style="margin:26px 0 0">
<p style="margin:0 0 3px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#15503a">What&rsquo;s assigned</p>
<p style="margin:0 0 14px;font-size:13px;color:#8b918d">${countLine}</p>
${showLabels ? itemGroup("🌲 Around the resort", mlr) : `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 4px">${mlr.map(itemCard).join("")}</table>`}
${houseItems.length ? itemGroup(`${bucket.emoji || "🏠"} ${houseName}`, houseItems, houseNote) : ""}
</div>`
    : "";

  const noteBlock = d.body
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0 0"><tr><td style="padding:14px 16px;background:#f6f6f1;border-radius:10px">
<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8b918d;margin-bottom:6px">Note from ${escapeHtml(d.sender_name || "the organizer")}</div>
<div style="font-size:14.5px;line-height:1.6;white-space:pre-wrap">${escapeHtml(d.body)}</div>
</td></tr></table>`
    : "";

  // ── Who sent this ──────────────────────────────────────────────────────────
  // ALWAYS shown, never conditional. The From line is the resort's shared
  // mailbox for every app email, so without this a member-sent note reads as
  // coming from "the resort" and nobody knows who organized it — or who to
  // reply to. Naming the sender every time IS the "someone else sent this"
  // disclaimer; a line that only appears sometimes is one people learn to skip.
  // Sits directly under the title as a byline, the pattern readers already know.
  const senderName = escapeHtml(d.sender_name || "a member");
  const replyClause = d.sender_email
    ? " &middot; replies to this email go straight to them"
    : "";
  const byline = `<p style="margin:0 0 18px;font-size:13px;color:#6b7b73;line-height:1.5">Sent by <strong style="color:#14241c">${senderName}</strong>${replyClause}</p>`;

  const subject = d.subject
    ? `${emoji} ${d.subject}`
    : `${emoji} ${d.event_title}${d.event_when ? ` — ${d.event_when}` : ""}`;

  // ── How to respond ─────────────────────────────────────────────────────────
  // ALWAYS rendered. The whole point of the email is finding out who's coming,
  // so "here's how to answer" can't be a faint caption under a button — it's
  // given its own bordered block with the ask stated first. Two routes on
  // purpose: the app (which updates the real headcount everyone sees) and a
  // plain reply, which reaches the sender directly via Reply-To. Nobody gets
  // stuck because they don't want to open the app.
  const respondBlock = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:26px 0 0"><tr><td style="padding:16px 18px;background:#f4f8f5;border:1px solid #dbe7df;border-radius:12px">
<p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#14241c;line-height:1.4">Can you make it? Let us know.</p>
<p style="margin:0 0 14px"><a href="${link}" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:15px;font-weight:600">RSVP in the app →</a></p>
<p style="margin:0;font-size:13px;color:#4a5a52;line-height:1.6">Tapping through lets you say Going, Maybe, or Can&rsquo;t make it &mdash; and you can see who else is coming and check tasks off as they get done.<br>Not up for the app? <strong>Just reply to this email</strong> and you&rsquo;ll be added by hand.</p>
</td></tr></table>`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:560px">
<p style="margin:0 0 16px;color:#15503a;font-weight:700;font-size:11.5px;letter-spacing:.13em">MUSKELLUNGE LAKE RESORT</p>
<p style="font-size:22px;margin:0 0 4px;line-height:1.25"><strong>${escapeHtml(emoji)} ${escapeHtml(d.event_title)}</strong></p>
<div style="height:3px;width:44px;background:#15503a;border-radius:2px;margin:12px 0 14px"></div>
${byline}
${detailRows ? `<table role="presentation" style="border-collapse:collapse;font-size:14.5px;margin:0">${detailRows}</table>` : ""}
${noteBlock}
${workSection}
${respondBlock}
<hr style="border:none;border-top:1px solid #e8e8e4;margin:26px 0 13px">
<p style="color:#a3a9a5;font-size:11.5px;margin:0;line-height:1.6">Muskellunge Lake Resort · Muskellunge Lake, 5 mi from Tomahawk on Hwy 8, Tomahawk, WI<br>You&rsquo;re receiving this because you&rsquo;re on the family roster for Muskellunge Lake Resort.</p>
</div>`;

  const textGroup = (label, items) =>
    items && items.length
      ? `\n${label}\n${items
          .map((i) => {
            const meta = [urgencyLabel(i), i.peopleNeeded ? `${i.peopleNeeded} needed` : ""].filter(Boolean).join(" · ");
            return `  • ${i.title}${meta ? `  [${meta}]` : ""}${
              i.notes ? `\n      ${String(i.notes).replace(/\n/g, "\n      ")}` : ""
            }`;
          })
          .join("\n")}\n`
      : "";
  const text = `${d.event_title}${d.event_when ? `\n${d.event_when}` : ""}\nSent by ${d.sender_name || "a member"}${d.sender_email ? " (replies go straight to them)" : ""}${
    d.event_location ? `\nWhere: ${d.event_location}` : ""
  }${d.event_description ? `\n\n${d.event_description}` : ""}${
    d.body ? `\n\nNote from ${d.sender_name || "the organizer"}:\n${d.body}` : ""
  }${
    total
      ? `\n\nWHAT'S ASSIGNED — ${
          showLabels
            ? `${mlr.length} around the resort, ${houseItems.length} for ${houseName}`
            : `${total} task${total === 1 ? "" : "s"}`
        }`
      : ""
  }${textGroup(showLabels ? "Around the resort:" : "", mlr)}${
    houseItems.length
      ? `\n${houseName}:\n  (Only in ${houseName}'s copy of this email — everyone else got the same note without these tasks.)${textGroup("", houseItems)}`
      : ""
  }\nCAN YOU MAKE IT? LET US KNOW.\nRSVP in the app: ${link}\nOr just reply to this email and you'll be added by hand.\n\n— Muskellunge Lake Resort`;

  return { subject, html, text, taskCount: total };
}

module.exports = { buildEventEmail, escapeHtml, urgencyLabel };
