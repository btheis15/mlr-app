#!/usr/bin/env node
// Render the "email everyone about this event" template (migration 0190) to a
// standalone HTML file, using realistic sample data, so the layout can be
// reviewed (or printed to PDF) without sending anything.
//
//   node scripts/preview-event-email.js [out.html]
//
// It calls the SAME buildEventEmail() the mac-mini mailer calls, so what you see
// here is what actually goes out — the whole reason the template lives in its own
// module instead of inline in alert-mailer.js.
//
// To get a PDF (Chromium is preinstalled on the media-server box / CI image):
//   chromium --headless --disable-gpu --no-pdf-header-footer \
//     --print-to-pdf=preview.pdf file:///abs/path/preview.html

const fs = require("fs");
const path = require("path");
const { buildEventEmail } = require("../media-server/event-email-template");

// Shaped exactly like an `event_message_email()` row.
const SAMPLE = {
  subject: null, // left blank → subject falls back to the event name + dates
  body:
    "Hey everybody — pulling the pier and closing up the boathouse before the weather turns. " +
    "Come for the whole weekend or just a few hours Saturday, whatever works.\n\n" +
    "Bring waders if you have them, and a cordless drill if you own one. " +
    "Lunch both days is covered.",
  sender_name: "Brian Theis",
  event_id: "9f1c7e2a-0000-4000-8000-00000000abcd",
  event_title: "Fall Work Weekend + Megan's 30th B-Day",
  event_when: "Sep 25 – 27, 2026",
  event_emoji: "🛟",
  event_location: "Down by the Lake",
  event_description:
    "Taking apart and bringing in the pier. Organizing the boathouse. Bring waders if you have them.",
  work_items: [
    {
      title: "Take out Pier",
      notes:
        "Sections come apart at the bolts — 9/16\" wrench. Stack them up behind the boathouse, " +
        "not on the grass. Needs a few people in waders for the deep end.",
      urgency: "asap",
      peopleNeeded: 6,
      status: "open",
    },
    {
      title: "Another board needs replacing",
      notes: "Third board from the end on the main dock walkway — it's soft and flexing underfoot.",
      urgency: "asap",
      peopleNeeded: 2,
      status: "open",
    },
    {
      title: "Under-deck concrete power washing",
      notes: "Green algae along the north edge where it stays shaded. Washer is in the pump house.",
      urgency: "this_year",
      peopleNeeded: 1,
      status: "open",
    },
    {
      title: "Scrape, chink, caulk and paint Red & White cabin upstairs windows",
      notes:
        "All four upstairs windows. Scrape loose paint, re-chink the gaps, caulk, then two coats. " +
        "Paint and brushes are in the shed — the forest green, not the trim white.",
      urgency: "custom",
      customLabel: "Before first frost",
      customColor: "orange",
      peopleNeeded: 5,
      status: "open",
    },
    {
      title: "Deck staining",
      notes: "Every 3 years — last done in 2023, so it's due. Wait for two dry days in a row.",
      urgency: "next_year",
      peopleNeeded: 3,
      status: "open",
    },
    {
      title: "Replace roofing on small pump/hose house",
      notes: "Shingles are curling on the south slope. Materials already bought, they're in the barn.",
      urgency: "nice_to_have",
      peopleNeeded: 3,
      status: "open",
    },
    {
      title: "Clear the brush along the driveway",
      notes: "Done in August — the pile by the turnaround still needs burning once we get a permit.",
      urgency: "this_year",
      peopleNeeded: 2,
      status: "done",
    },
  ],
  house_counts: [
    { name: "MJT House", emoji: "🏠", count: 2 },
  ],
  emails: [],
};

const APP_URL = "https://mlr-app-omega.vercel.app";
const { subject, html, text } = buildEventEmail(SAMPLE, APP_URL);

const out = process.argv[2] || path.join(process.cwd(), "event-email-preview.html");
// Wrapped in a light page + a little "this is a preview" chrome showing the
// subject line and the From/To an inbox would display, so the print-out reads
// like the email rather than a bare fragment.
const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${subject.replace(/[<>&]/g, "")}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { margin:0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .wrap { max-width:640px; margin:0 auto; padding:8px 0 24px; }
  .hdr { border:1px solid #e8e8e4; border-radius:12px; padding:14px 16px; margin:0 0 22px;
         font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  .hdr div { font-size:12.5px; color:#8b918d; margin:0 0 4px; }
  .hdr div:last-child { margin:0; }
  .hdr b { color:#14241c; font-weight:600; }
  .subj { font-size:15px !important; color:#14241c !important; font-weight:600; }
</style></head>
<body><div class="wrap">
<div class="hdr">
  <div class="subj">${subject}</div>
  <div>From <b>Muskellunge Lake Resort &lt;alerts@muskellungelakeresort.com&gt;</b></div>
  <div>To <b>Muskellunge Lake Resort</b> · bcc: the family (app members + roster)</div>
</div>
${html}
</div></body></html>`;

fs.writeFileSync(out, page, "utf8");
console.log(`Wrote ${out}`);
console.log(`\nSubject: ${subject}\n`);
console.log("── plain-text part ──────────────────────────────────────────");
console.log(text);
