#!/usr/bin/env node
// Render the House Requests emails (migration 0195) to HTML files for review,
// from the SAME builder alert-mailer.js calls — a preview that could disagree
// with the real send would be worthless (the event-email preview's rationale).
//
//   node scripts/preview-house-request-email.js [outDir]
//
// Writes one file per variant into outDir (default: a temp dir it prints), then
// open them in a browser. To make PDFs, print with headless Chromium:
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --headless --disable-gpu --print-to-pdf=out.pdf file:///path/to/file.html

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildHouseRequestEmail,
  buildHouseRequestDecisionEmail,
} = require("../media-server/house-request-email-template");

const FROM = "brian@example.com";

// Shaped exactly like a `house_request_notification()` row.
const base = {
  request_id: "00000000-0000-4000-8000-000000000001",
  house_name: "MJT House",
  house_slug: "mjt-house",
  requester_name: "Cass",
  requester_email: "cass@example.com",
  reviewer_name: "Beth",
  reviewer_email: "beth@example.com",
  pending_count: 4,
};

const VARIANTS = [
  {
    file: "01-approver-purchase.html",
    label: "To House Admins — purchase request, with links + a queue behind it",
    build: () =>
      buildHouseRequestEmail(
        {
          ...base,
          kind: "purchase",
          title: "Soft-close bumpers for the kitchen cabinets",
          reason:
            "Half the cabinet doors stick and you have to bang them shut. These are a few dollars a pack and fix it for good.",
          est_cost: 17.98,
          quantity: 2,
          status: "pending",
          links: [
            { href: "https://www.homedepot.com/p/some-bumpers/123456", label: "Home Depot — 100 pack" },
            { href: "https://www.amazon.com/dp/B0EXAMPLE", label: null },
          ],
        },
        { fromAddress: FROM },
      ),
  },
  {
    file: "02-approver-idea.html",
    label: "To House Admins — an idea, no cost, no link",
    build: () =>
      buildHouseRequestEmail(
        {
          ...base,
          pending_count: 1,
          kind: "idea",
          title: "European-style dressers for the upstairs bedrooms",
          reason: "Mom loved these. They'd fit the upstairs rooms and finally give everyone real drawer space.",
          est_cost: null,
          quantity: null,
          status: "pending",
          links: [],
        },
        { fromAddress: FROM },
      ),
  },
  {
    file: "03-approver-reimbursement.html",
    label: "To House Admins — reimbursement, amount already spent",
    build: () =>
      buildHouseRequestEmail(
        {
          ...base,
          pending_count: 2,
          kind: "reimbursement",
          title: "Two gallons of deck stain",
          reason: "Grabbed these before the work weekend so we didn't lose half a day to a hardware run.",
          est_cost: 84.5,
          quantity: null,
          status: "pending",
          links: [],
        },
        { fromAddress: FROM },
      ),
  },
  {
    file: "04-decision-approved.html",
    label: "To the requester — approved, with a note",
    build: () =>
      buildHouseRequestDecisionEmail(
        {
          ...base,
          kind: "purchase",
          title: "Soft-close bumpers for the kitchen cabinets",
          status: "approved",
          est_cost: 17.98,
          actual_cost: null,
          review_note: "Good call — grab the bigger pack while you're at it.",
          order_note: null,
        },
        { fromAddress: FROM },
      ),
  },
  {
    file: "05-decision-denied.html",
    label: "To the requester — turned down",
    build: () =>
      buildHouseRequestDecisionEmail(
        {
          ...base,
          kind: "idea",
          title: "European-style dressers for the upstairs bedrooms",
          status: "denied",
          est_cost: 1200,
          actual_cost: null,
          review_note: "Love it, but let's revisit after the roof. Keeping it on the list.",
          order_note: null,
        },
        { fromAddress: FROM },
      ),
  },
  {
    file: "06-decision-ordered.html",
    label: "To the requester — ordered, actual cost differs from the estimate",
    build: () =>
      buildHouseRequestDecisionEmail(
        {
          ...base,
          kind: "purchase",
          title: "Soft-close bumpers for the kitchen cabinets",
          status: "ordered",
          est_cost: 17.98,
          actual_cost: 22.4,
          review_note: null,
          order_note: "Ordered from Home Depot, should be here Thursday.",
        },
        { fromAddress: FROM },
      ),
  },
  {
    file: "07-changed.html",
    label: "To the requester — a House Admin CHANGED it (not decided), with a note",
    build: () =>
      buildHouseRequestDecisionEmail(
        {
          ...base,
          kind: "purchase",
          title: "Soft-close bumpers — 100 pack",
          status: "pending",
          est_cost: 24.99,
          actual_cost: null,
          quantity: 1,
          review_note: null,
          change_note: "Going with the 100-pack instead — works out cheaper per bumper and we'll use them.",
          order_note: null,
        },
        { fromAddress: FROM, outcome: "changed" },
      ),
  },
  {
    file: "08-decision-paid.html",
    label: "To the requester — reimbursement paid",
    build: () =>
      buildHouseRequestDecisionEmail(
        {
          ...base,
          kind: "reimbursement",
          title: "Two gallons of deck stain",
          status: "received",
          est_cost: 84.5,
          actual_cost: 84.5,
          review_note: "Sent it on Venmo, thanks for grabbing these.",
          order_note: null,
        },
        { fromAddress: FROM },
      ),
  },
];

const outDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "mlr-house-request-email-"));
fs.mkdirSync(outDir, { recursive: true });

for (const v of VARIANTS) {
  const { subject, html, text } = v.build();
  // Wrap in a minimal page with the app's paper background, so the preview looks
  // like an inbox rather than a bare white void — and show the subject line and
  // the plain-text part, since both ship with every send and both can be wrong.
  const page = `<!doctype html><meta charset="utf-8"><title>${subject}</title>
<div style="background:#f6f6f1;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">
  <div style="max-width:620px;margin:0 auto">
    <p style="font-size:12px;color:#8b918d;margin:0 0 4px">${v.label}</p>
    <p style="font-size:13px;color:#14241c;margin:0 0 16px"><strong>Subject:</strong> ${subject}</p>
    <div style="background:#fff;padding:26px;border-radius:14px;border:1px solid #e8e8e4">${html}</div>
    <details style="margin-top:18px">
      <summary style="font-size:12px;color:#8b918d;cursor:pointer">Plain-text part</summary>
      <pre style="white-space:pre-wrap;font-size:12px;color:#4a5a52;background:#fff;padding:16px;border-radius:10px;border:1px solid #e8e8e4">${text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>
    </details>
  </div>
</div>`;
  fs.writeFileSync(path.join(outDir, v.file), page);
  console.log(`${v.file}  —  ${subject}`);
}

console.log(`\n${VARIANTS.length} previews written to:\n  ${outDir}`);
