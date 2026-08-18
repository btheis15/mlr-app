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

// ⚠️ SAMPLE DATA ONLY — and it must stay obviously generic.
// Nothing here is a real plan, and nothing invented here should ever read like
// a commitment the family has actually made ("lunch is covered", "materials are
// bought"). A preview is for checking LAYOUT; if its filler is mistaken for
// real content it has done harm rather than good. Keep the note text plainly
// placeholder-shaped, and never add specifics nobody agreed to.
//
// None of this reaches a real send: a live email renders only what's in the
// database — the event's own title/date/location/description, the sender's
// typed note, and each work item's title + notes.

const fs = require("fs");
const path = require("path");
const { buildEventEmail } = require("../media-server/event-email-template");

// Shaped exactly like an `event_message_email()` row.
const SAMPLE = {
  subject: null, // left blank → subject falls back to the event name + dates
  // Placeholder on purpose — see the note at the top of this file. This is where
  // whatever the sender types in "A note to include" appears.
  body:
    "[Sample note] This is where the note the sender types in the app shows up — " +
    "whatever they want to say up front, in their own words.\n\n" +
    "It keeps their line breaks, and it is left out entirely when they don't write one.",
  sender_name: "Megan Theis",
  // A NON-admin member who created the event — the case the byline exists for.
  sender_email: "megan@example.com",
  event_id: "9f1c7e2a-0000-4000-8000-00000000abcd",
  event_title: "Fall Work Weekend",
  event_when: "Sep 25 – 27, 2026",
  event_emoji: "🛟",
  event_location: "Down by the Lake",
  event_description:
    "Taking apart and bringing in the pier. Organizing the boathouse. Bring waders if you have them.",
  mlr_items: [
    {
      title: "Take out Pier",
      notes:
        "Sections come apart at the bolts — 9/16\" wrench. Stack them up behind the boathouse, " +
        "not on the grass. Needs a few people in waders for the deep end.",
      urgency: "asap",
      peopleNeeded: 6,
    },
    {
      title: "Another board needs replacing",
      notes: "Third board from the end on the main dock walkway — it's soft and flexing underfoot.",
      urgency: "asap",
      peopleNeeded: 2,
    },
    {
      title: "Under-deck concrete power washing",
      notes: "Green algae along the north edge where it stays shaded. Washer is in the pump house.",
      urgency: "this_year",
      peopleNeeded: 1,
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
    },
    {
      title: "Deck staining",
      notes: "Every 3 years — last done in 2023, so it's due. Wait for two dry days in a row.",
      urgency: "next_year",
      peopleNeeded: 3,
    },
    {
      title: "Replace roofing on small pump/hose house",
      notes: "Shingles are curling on the south slope. Materials already bought, they're in the barn.",
      urgency: "nice_to_have",
      peopleNeeded: 3,
    },
  ],
  // One group per house that has tasks on this event — its people get the
  // resort-wide list AND this list; everyone else never sees it.
  house_groups: [
    {
      houseId: "b2d4f6a8-0000-4000-8000-00000000mjt1",
      name: "MJT House",
      emoji: "🏠",
      emails: ["placeholder@example.com"],
      items: [
        {
          title: "MJT: Swap the propane tanks + check the regulator",
          notes:
            "Both tanks are near empty. Fresh ones are behind the shed; the regulator has been hissing " +
            "faintly, so give it a soap test while you're down there.",
          urgency: "asap",
          peopleNeeded: 2,
        },
        {
          title: "MJT: Clean the gutters on the lake side",
          notes: "Full of pine needles — it overflowed onto the deck during the last big rain.",
          urgency: "this_year",
          peopleNeeded: 2,
        },
      ],
    },
  ],
  general_emails: ["placeholder@example.com"],
};

const APP_URL = "https://mlr-app-omega.vercel.app";
const house = SAMPLE.house_groups[0];

// Both real sends, from the same builder the mailer uses.
const variants = [
  {
    who: `Version 1 — for ${house.name} (and anyone else in a house with tasks here)`,
    note: `Gets the resort-wide tasks PLUS ${house.name}'s own tasks.`,
    built: buildEventEmail(SAMPLE, APP_URL, house),
  },
  {
    who: "Version 2 — for everyone else",
    note: "Anyone not in a house, or in a house with nothing assigned to this event. Resort-wide tasks only — no sign a house has its own list.",
    built: buildEventEmail(SAMPLE, APP_URL, null),
  },
];

const out = process.argv[2] || path.join(process.cwd(), "event-email-preview.html");
const section = (v, i) => `
<div class="variant${i ? " brk" : ""}">
  <div class="who"><b>${v.who}</b><span>${v.note}</span></div>
  <div class="hdr">
    <div class="subj">${v.built.subject}</div>
    <div>From <b>Muskellunge Lake Resort &lt;alerts@muskellungelakeresort.com&gt;</b></div>
    <div>bcc <b>${v.built === variants[0].built ? house.name + "'s people" : "everyone else"}</b> — blind, so nobody sees the list</div>
  </div>
  ${v.built.html}
</div>`;

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>MLR event email — both versions</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { margin:0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;
         font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:640px; margin:0 auto; padding:6px 0 24px; }
  .variant { padding:0 0 10px; }
  .brk { page-break-before: always; }
  .who { background:#15503a; color:#fff; border-radius:10px; padding:11px 14px; margin:0 0 14px; }
  .who b { display:block; font-size:14px; }
  .who span { display:block; font-size:12px; opacity:.85; margin-top:3px; line-height:1.45; }
  .hdr { border:1px solid #e8e8e4; border-radius:12px; padding:14px 16px; margin:0 0 22px; }
  .hdr div { font-size:12.5px; color:#8b918d; margin:0 0 4px; }
  .hdr div:last-child { margin:0; }
  .hdr b { color:#14241c; font-weight:600; }
  .subj { font-size:15px !important; color:#14241c !important; font-weight:600; }
</style></head>
<body><div class="wrap">${variants.map(section).join("")}</div></body></html>`;

fs.writeFileSync(out, page, "utf8");
console.log(`Wrote ${out}`);
for (const v of variants) {
  console.log(`\n════ ${v.who}`);
  console.log(`Subject: ${v.built.subject}`);
  console.log(v.built.text);
}
