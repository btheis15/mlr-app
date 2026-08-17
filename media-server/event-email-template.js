// The "email everyone about this event" template (migration 0190).
//
// Lives in its own module — rather than inline in alert-mailer.js like the older
// emails — so `scripts/preview-event-email.js` can render the EXACT same markup
// to a PDF for review. If the preview and the real send could drift, the preview
// would be worthless; there is one builder and both call it.
//
// Input is the `event_message_email()` RPC row verbatim (snake_case columns,
// work_items/house_counts as parsed jsonb) plus the app's base URL.

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

/** One work item as its own titled card: the title, then ITS DETAILS, then the
 *  urgency/headcount meta line. `muted` renders an already-done item. */
function itemCard(it, muted) {
  const meta = [
    urgencyLabel(it) ? `<span style="white-space:nowrap">${escapeHtml(urgencyLabel(it))}</span>` : "",
    it.peopleNeeded ? `<span style="white-space:nowrap">👥 ${Number(it.peopleNeeded)} needed</span>` : "",
  ]
    .filter(Boolean)
    .join('<span style="color:#c8cfcb"> · </span>');
  return `<tr><td style="padding:0 0 10px">
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0">
<tr><td style="padding:12px 15px;background:${muted ? "#f7f7f5" : "#f4f8f5"};border-left:3px solid ${muted ? "#cdcdc6" : "#15503a"};border-radius:9px">
<div style="font-size:15.5px;font-weight:600;line-height:1.35;color:${muted ? "#8b918d" : "#14241c"}${muted ? ";text-decoration:line-through" : ""}">${escapeHtml(it.title || "")}</div>
${it.notes ? `<div style="margin-top:5px;font-size:13.5px;color:#4a5a52;line-height:1.55;white-space:pre-wrap">${escapeHtml(it.notes)}</div>` : ""}
${meta ? `<div style="margin-top:7px;font-size:12px;color:#6b7b73">${meta}</div>` : ""}
</td></tr></table>
</td></tr>`;
}

/**
 * Build the subject + HTML + plain-text parts.
 * @param {object} d   an `event_message_email()` row
 * @param {string} appUrl  base app URL (no trailing slash)
 */
function buildEventEmail(d, appUrl) {
  const items = Array.isArray(d.work_items) ? d.work_items : [];
  const houses = Array.isArray(d.house_counts) ? d.house_counts : [];
  const open = items.filter((i) => i.status !== "done");
  const done = items.filter((i) => i.status === "done");
  const emoji = d.event_emoji || "📅";
  const link = `${appUrl}/events?open=${encodeURIComponent(d.event_id)}`;

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

  const openCards = open.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0">${open.map((i) => itemCard(i, false)).join("")}</table>`
    : "";
  const doneCards = done.length
    ? `<p style="margin:16px 0 8px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8b918d">Already done</p>
<table role="presentation" style="width:100%;border-collapse:collapse">${done.map((i) => itemCard(i, true)).join("")}</table>`
    : "";
  // Houses get a COUNT only — their items are private to that house (0066/0189).
  const houseLines = houses.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:14px 0 0">${houses
        .map(
          (h) =>
            `<tr><td style="padding:9px 13px;background:#f7f7f5;border-radius:9px;font-size:13px;color:#6b7b73;line-height:1.45">${escapeHtml(h.emoji || "🏠")} <strong style="color:#14241c">${escapeHtml(h.name || "House")}</strong> · ${Number(h.count)} item${Number(h.count) === 1 ? "" : "s"} planned <span style="color:#a3a9a5">— details in the app</span></td></tr>
<tr><td style="height:7px;line-height:7px">&nbsp;</td></tr>`,
        )
        .join("")}</table>`
    : "";

  const plannedCount = open.length + done.length;
  const workSection =
    plannedCount || houses.length
      ? `<div style="margin:26px 0 0">
<p style="margin:0 0 3px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#15503a">What&rsquo;s planned</p>
<p style="margin:0 0 13px;font-size:13px;color:#8b918d">${
          plannedCount
            ? `${open.length} item${open.length === 1 ? "" : "s"} to tackle${done.length ? ` · ${done.length} already done` : ""}`
            : "Around the resort"
        }</p>
${openCards}${doneCards}${houseLines}
</div>`
      : "";

  const noteBlock = d.body
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0 0"><tr><td style="padding:14px 16px;background:#f6f6f1;border-radius:10px">
<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8b918d;margin-bottom:6px">Note from ${escapeHtml(d.sender_name || "the organizer")}</div>
<div style="font-size:14.5px;line-height:1.6;white-space:pre-wrap">${escapeHtml(d.body)}</div>
</td></tr></table>`
    : "";

  const subject = d.subject
    ? `${emoji} ${d.subject}`
    : `${emoji} ${d.event_title}${d.event_when ? ` — ${d.event_when}` : ""}`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:560px">
<p style="margin:0 0 16px;color:#15503a;font-weight:700;font-size:11.5px;letter-spacing:.13em">MUSKELLUNGE LAKE RESORT</p>
<p style="font-size:22px;margin:0 0 4px;line-height:1.25"><strong>${escapeHtml(emoji)} ${escapeHtml(d.event_title)}</strong></p>
<div style="height:3px;width:44px;background:#15503a;border-radius:2px;margin:12px 0 18px"></div>
${detailRows ? `<table role="presentation" style="border-collapse:collapse;font-size:14.5px;margin:0">${detailRows}</table>` : ""}
${noteBlock}
${workSection}
<p style="margin:28px 0 0"><a href="${link}" style="display:inline-block;background:#15503a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:15px;font-weight:600">RSVP &amp; see the full plan →</a></p>
<p style="margin:11px 0 0;font-size:12.5px;color:#8b918d;line-height:1.5">Tap above to say if you&rsquo;re coming, see who else is, and check work off as it gets done.</p>
<hr style="border:none;border-top:1px solid #e8e8e4;margin:26px 0 13px">
<p style="color:#a3a9a5;font-size:11.5px;margin:0;line-height:1.6">Muskellunge Lake Resort · Muskellunge Lake, 5 mi from Tomahawk on Hwy 8, Tomahawk, WI<br>You&rsquo;re receiving this because you&rsquo;re on the family roster for Muskellunge Lake Resort.</p>
</div>`;

  const textItems = (list, heading) =>
    list.length
      ? `\n${heading}\n${list
          .map((i) => {
            const meta = [urgencyLabel(i), i.peopleNeeded ? `${i.peopleNeeded} needed` : ""].filter(Boolean).join(" · ");
            return `  • ${i.title}${meta ? `  [${meta}]` : ""}${
              i.notes ? `\n      ${String(i.notes).replace(/\n/g, "\n      ")}` : ""
            }`;
          })
          .join("\n")}\n`
      : "";
  const text = `${d.event_title}${d.event_when ? `\n${d.event_when}` : ""}${
    d.event_location ? `\nWhere: ${d.event_location}` : ""
  }${d.event_description ? `\n\n${d.event_description}` : ""}${
    d.body ? `\n\nNote from ${d.sender_name || "the organizer"}:\n${d.body}` : ""
  }${plannedCount || houses.length ? `\n\nWHAT'S PLANNED` : ""}${textItems(open, "To tackle:")}${textItems(
    done,
    "Already done:",
  )}${
    houses.length
      ? `\n${houses
          .map((h) => `  • ${h.name}: ${h.count} item${Number(h.count) === 1 ? "" : "s"} planned (details in the app)`)
          .join("\n")}\n`
      : ""
  }\nRSVP & see the full plan: ${link}\n\n— Muskellunge Lake Resort`;

  return { subject, html, text, plannedCount };
}

module.exports = { buildEventEmail, escapeHtml, urgencyLabel };
