// The House Requests emails (migration 0195).
//
// Two builders, one look:
//   • buildHouseRequestEmail()         → to the House Admins, when a request
//                                        comes in. This is the important one:
//                                        an approver may go days without
//                                        opening the app, and a request nobody
//                                        sees is the whole problem this feature
//                                        exists to fix.
//   • buildHouseRequestDecisionEmail() → to the requester, when it's decided,
//                                        ordered, or paid.
//
// Its own module (rather than inline in alert-mailer.js like the older emails)
// for the same reason event-email-template.js is: one builder means a preview
// can never drift from the real send. Deliberately NOT sharing that file —
// nothing here is event-shaped, and coupling them would mean every change to one
// email risks the other.
//
// ⚠️ NO LINK TO THE APP, ANYWHERE — by explicit decision, matching the event
// email. A member who installed MLR to their Home Screen / Dock has their
// signed-in session inside THAT container; tapping a bare link opens the browser
// instead, which on iOS is a separate, signed-out session (see
// InstallFirstNudge in components/IdentityProvider.tsx). So a link would COST
// them a re-sign-in rather than save a step. We name the app in plain text and
// let them open it the way they already do. A product link (Amazon, Home Depot)
// is a different thing entirely — that's the substance of a purchase request and
// has no session to lose, so those are kept.

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ⚠️⚠️ MIRRORS `KIND_META` in lib/houseRequests.ts — keep the wording in step.
// Each kind carries the DEAL ("whose money, who places the order") and the
// recipient's actual JOB, because this email is where a House Admin first meets
// a request and "Type: Purchase Request" told them nothing about who was
// expected to buy it. That ambiguity is the reason a real request went unordered:
// the admins read it as "he's buying this himself." Never reduce these back to a
// bare noun.
const KIND = {
  purchase: {
    emoji: "🛒",
    label: "Purchase request",
    costLabel: "Estimated",
    deal: "House Trust money — a House Admin places the order, not the person asking.",
    // What the recipient does. Second person, imperative, no hedging.
    job: "They're asking you to buy this with House Trust funds.",
    todo: "order it and mark it ordered",
  },
  idea: {
    emoji: "💡",
    label: "Idea",
    costLabel: "Rough cost",
    deal: "Nobody buys anything — just a thought for the house to kick around.",
    job: "Nothing to buy here. They just want to know if the house is up for it.",
    todo: "say whether the house likes it",
  },
  // "Total" not "Amount", since a reimbursement is usually several things on one
  // receipt — matches the composer's "What's the total?".
  reimbursement: {
    emoji: "🧾",
    // ⚠️ A NOUN, not the requester-voice "Pay me back" — the co-admin email says
    // "Lee paid Brian's <label>", and the preview script will show you exactly how
    // badly a first-person phrase reads there.
    label: "Reimbursement",
    costLabel: "Total spent",
    deal: "Already paid for out of pocket — the House Trust pays it back.",
    job: "They already paid for this out of their own pocket and are asking to be paid back.",
    todo: "approve it and send them the money",
  },
};

function kindOf(kind) {
  return KIND[kind] || KIND.idea;
}

/** Mirrors formatMoney() in lib/format.ts: drop cents on a whole amount, keep
 *  them when they're real, and render a missing amount as an em dash rather
 *  than "$0" — "nobody said what it costs" must not read as "it's free". */
function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  if (!Number.isFinite(n)) return "—";
  const whole = Math.abs(n % 1) < 0.005;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

function hasMoney(v) {
  if (v === null || v === undefined || v === "") return false;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n);
}

/**
 * "Who actually sent this, and why isn't it from them?"
 *
 * ⚠️ Every app email leaves from ONE shared mailbox — a personal address that
 * happens to be the account the mini sends through. Without saying so, a
 * request from a cousin arrives looking like the mailbox owner wrote it, which
 * misattributes it to someone who had nothing to do with it and leaves nobody
 * knowing who to answer. So the real person is named in the byline up top AND
 * the From address is explained down here, on every send, unconditionally: a
 * disclaimer that only appears sometimes is one readers learn to skip.
 *
 * @param {string} who        the real sender's display name
 * @param {string} what       what they did, e.g. "sent this request"
 * @param {string} fromAddr   the address the mail actually left from
 * @param {boolean} replyGoes whether Reply-To is set to the real sender
 */
function sentByNote(who, what, fromAddr, replyGoes) {
  const addr = fromAddr ? escapeHtml(fromAddr) : "the resort&rsquo;s email account";
  return `<p style="color:#a3a9a5;font-size:11.5px;margin:0 0 8px;line-height:1.6"><strong style="color:#6b7b73">${escapeHtml(
    who,
  )}</strong> ${escapeHtml(what)} — the MLR app emailed it on their behalf, automatically, from ${addr}. That&rsquo;s
the single account the app sends all of its mail through, so it&rsquo;s the app writing, not whoever owns that
address.${replyGoes ? " Replying goes to " + escapeHtml(who) + "." : ""}</p>`;
}

/** Plain-text twin of sentByNote. */
function sentByText(who, what, fromAddr, replyGoes) {
  return `${who} ${what} — the MLR app emailed it on their behalf, automatically, from ${
    fromAddr || "the resort's email account"
  }. That's the single account the app sends all its mail through, so it's the app writing, not whoever owns that address.${
    replyGoes ? ` Replying goes to ${who}.` : ""
  }`;
}

/** Shared chrome: the wordmark, the title, the green rule, and the footer. */
function shell(titleHtml, bodyHtml, footerNoteHtml = "") {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14241c;max-width:560px">
<p style="margin:0 0 16px;color:#15503a;font-weight:700;font-size:11.5px;letter-spacing:.13em">MUSKELLUNGE LAKE RESORT</p>
${titleHtml}
<div style="height:3px;width:44px;background:#15503a;border-radius:2px;margin:12px 0 14px"></div>
${bodyHtml}
<hr style="border:none;border-top:1px solid #e8e8e4;margin:26px 0 13px">
${footerNoteHtml}
<p style="color:#a3a9a5;font-size:11.5px;margin:0;line-height:1.6">Muskellunge Lake Resort · Muskellunge Lake, 5 mi from Tomahawk on Hwy 8, Tomahawk, WI<br>You&rsquo;re receiving this because you&rsquo;re on the family roster for Muskellunge Lake Resort.</p>
</div>`;
}

/** A label/value table row, matching the event email's detail block. */
function row(label, valueHtml) {
  return `<tr><td style="padding:5px 18px 5px 0;color:#8b918d;white-space:nowrap;vertical-align:top;font-size:13px">${label}</td><td style="padding:5px 0;line-height:1.5">${valueHtml}</td></tr>`;
}

/** "amazon.com" from a URL, so an unlabeled link still reads as a destination. */
function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

/** The product/reference links as their own cards. Kept (unlike an app link) —
 *  for a purchase request this IS the content, and an external URL has no
 *  signed-in session to lose. */
function linksBlock(links) {
  const list = Array.isArray(links) ? links.filter((l) => l && l.href) : [];
  if (!list.length) return "";
  const rows = list
    .map(
      (l) =>
        `<tr><td style="padding:0 0 8px"><a href="${escapeHtml(l.href)}" style="display:block;padding:11px 14px;background:#f4f8f5;border-left:3px solid #15503a;border-radius:9px;text-decoration:none;color:#15503a;font-size:14px;font-weight:600">🔗 ${escapeHtml(
          (l.label && String(l.label).trim()) || `Open on ${hostOf(l.href)}`,
        )}<div style="margin-top:3px;font-size:11.5px;font-weight:400;color:#6b7b73;word-break:break-all">${escapeHtml(
          l.href,
        )}</div></a></td></tr>`,
    )
    .join("");
  return `<div style="margin:22px 0 0">
<p style="margin:0 0 9px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#15503a">What they linked</p>
<table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table>
</div>`;
}

/** The reason, in the requester's own words. */
function reasonBlock(heading, reason) {
  if (!reason || !String(reason).trim()) return "";
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0 0"><tr><td style="padding:14px 16px;background:#f6f6f1;border-radius:10px">
<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8b918d;margin-bottom:6px">${escapeHtml(heading)}</div>
<div style="font-size:14.5px;line-height:1.6;white-space:pre-wrap">${escapeHtml(reason)}</div>
</td></tr></table>`;
}

/**
 * The "somebody asked for something" email → the House Admins.
 *
 * @param {object} d  a `house_request_notification()` row
 * @param {object} [opts]  { fromAddress } — the address the mail leaves from,
 *                         named in the footer so nobody thinks the mailbox owner
 *                         wrote this.
 */
function buildHouseRequestEmail(d, opts = {}) {
  const k = kindOf(d.kind);
  const houseName = d.house_name || "MLR";
  const qty = Number(d.quantity) > 1 ? Number(d.quantity) : null;
  const showCost = hasMoney(d.est_cost);
  // How many are waiting in total, so "check the app" is a concrete errand
  // rather than a vague nudge. 1 = just this one; more = there's a queue.
  const pending = Number(d.pending_count) || 0;
  const others = Math.max(0, pending - 1);

  const detailRows =
    row("From", `<strong>${escapeHtml(d.requester_name || "A member")}</strong>`) +
    row("House", escapeHtml(houseName)) +
    // The deal rides the Type row itself, so the one line naming what kind of
    // thing this is can't be read without also reading whose money it is.
    row(
      "Type",
      `${k.emoji} <strong>${escapeHtml(k.label)}</strong><div style="margin-top:3px;font-size:12.5px;color:#6b7b73;line-height:1.5">${escapeHtml(
        k.deal,
      )}</div>`,
    ) +
    (showCost ? row(k.costLabel, `<strong>${money(d.est_cost)}</strong>${qty ? ` <span style="color:#8b918d">· ×${qty}</span>` : ""}`) : "");

  // ── What to do next ────────────────────────────────────────────────────────
  // Always rendered, and deliberately link-free (see the module header). It
  // names the exact screen so nobody has to hunt: House → Requests.
  // ⚠️ The headline is now the recipient's actual JOB, per kind — "You decide this
  // one" is true of all three and so distinguishes none of them. On a purchase it
  // has to say outright that the ordering falls to the reader, because the reader
  // assuming otherwise is the failure this whole pass exists to fix.
  const actionBlock = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:26px 0 0"><tr><td style="padding:16px 18px;background:#f4f8f5;border:1px solid #dbe7df;border-radius:12px">
<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#14241c;line-height:1.4">${escapeHtml(k.job)}</p>
<p style="margin:0;font-size:14px;color:#4a5a52;line-height:1.6">Open the <strong>MLR app</strong> and go to <strong>House &rsaquo; Requests</strong> to ${escapeHtml(
    k.todo,
  )} — or change it, or turn it down${
    others > 0
      ? `. There ${others === 1 ? "is 1 other request" : `are ${others} other requests`} waiting there too`
      : ""
  }.</p>
</td></tr></table>`;

  const who = d.requester_name || "A member";
  const title = `<p style="font-size:22px;margin:0 0 4px;line-height:1.25"><strong>${k.emoji} ${escapeHtml(
    d.title || "A new request",
  )}</strong></p>`;
  // The requester is the subject of the byline, not the resort — they're the
  // person an approver is actually answering.
  // Per kind, because the RELATIONSHIP differs: one is asking the house to spend,
  // one is owed money back, one isn't about money at all. A single "asked for
  // this" phrasing flattened all three into the same thing.
  const strong = (s) => `<strong style="color:#14241c">${escapeHtml(s)}</strong>`;
  const bylineText =
    d.kind === "purchase"
      ? `${strong(who)} is asking ${strong(houseName)} to buy this`
      : d.kind === "reimbursement"
        ? `${strong(who)} already paid for this — ${strong(houseName)} owes them`
        : `${strong(who)} has an idea for ${strong(houseName)}`;
  const byline = `<p style="margin:0 0 18px;font-size:13px;color:#6b7b73;line-height:1.5">${bylineText}${
    d.requester_email ? " &middot; replies go straight to them" : ""
  }</p>`;

  const html = shell(
    title,
    `${byline}
<table role="presentation" style="border-collapse:collapse;font-size:14.5px;margin:0">${detailRows}</table>
${reasonBlock(d.kind === "reimbursement" ? "What it was for" : "Why they want it", d.reason)}
${linksBlock(d.links)}
${actionBlock}`,
    sentByNote(who, "sent this request", opts.fromAddress, Boolean(d.requester_email)),
  );

  const subject = `${k.emoji} ${houseName} request from ${d.requester_name || "a member"} — ${d.title || "new request"}${
    showCost ? ` (${money(d.est_cost)})` : ""
  }`;

  const text = `${k.label.toUpperCase()} — ${d.title || ""}
${k.deal}
Asked for by: ${who}
House: ${houseName}${showCost ? `\n${k.costLabel}: ${money(d.est_cost)}${qty ? ` x${qty}` : ""}` : ""}${
    d.reason && String(d.reason).trim()
      ? `\n\n${d.kind === "reimbursement" ? "What it was for" : "Why they want it"}:\n${d.reason}`
      : ""
  }${
    Array.isArray(d.links) && d.links.filter((l) => l && l.href).length
      ? `\n\nLinked:\n${d.links
          .filter((l) => l && l.href)
          .map((l) => `  • ${(l.label && String(l.label).trim()) || hostOf(l.href)} — ${l.href}`)
          .join("\n")}`
      : ""
  }

${k.job.toUpperCase()}
Open the MLR app and go to House > Requests to ${k.todo} — or change it, or turn it down${
    others > 0 ? ` (${others} other${others === 1 ? "" : "s"} waiting there too)` : ""
  }.

${sentByText(who, "sent this request", opts.fromAddress, Boolean(d.requester_email))}

— Muskellunge Lake Resort`;

  return { subject, html, text };
}

/**
 * The decision email → the requester. Covers approved / denied, and the later
 * ordered / received (or paid) steps, since they're the same shape: here's what
 * happened to your thing, and here's who said so.
 *
 * @param {object} d  a `house_request_notification()` row (post-update)
 * @param {object} [opts]  { fromAddress } — see buildHouseRequestEmail.
 */
function buildHouseRequestDecisionEmail(d, opts = {}) {
  const k = kindOf(d.kind);
  const isReimbursement = d.kind === "reimbursement";
  const OUTCOME = {
    approved: { emoji: "✅", head: "Approved", line: "Your request was approved." },
    denied: { emoji: "🚫", head: "Not approved", line: "Your request wasn't approved this time." },
    ordered: { emoji: "📦", head: "Ordered", line: "It's been ordered — it's on the way." },
    received: isReimbursement
      ? { emoji: "💵", head: "Paid", line: "Your reimbursement has been paid." }
      : { emoji: "🎉", head: "It's here", line: "It arrived." },
    // A reviewer CHANGED the request rather than deciding it — the third arm of
    // approve/deny/modify. Passed via opts.outcome (the row's own status is
    // still whatever it was), since the whole point is that nothing was decided.
    changed: { emoji: "✏️", head: "Changed", line: "A House Admin made a change to your request." },
  };
  const o = OUTCOME[opts.outcome || d.status] || OUTCOME.approved;
  // On a change, the note to surface is the CHANGE note, not a past decision's.
  const note = opts.outcome === "changed" ? d.change_note : d.review_note;
  const cost = hasMoney(d.actual_cost) ? d.actual_cost : d.est_cost;

  const changed = opts.outcome === "changed";
  const detailRows =
    row("Status", `<strong>${o.emoji} ${escapeHtml(o.head)}</strong>`) +
    row("Type", `${k.emoji} ${escapeHtml(k.label)}`) +
    // What it says NOW, after the edit — the reader's own copy is out of date,
    // so a change email that doesn't restate the ask is useless.
    (changed ? row("Now reads", `<strong>${escapeHtml(d.title || "")}</strong>`) : "") +
    (hasMoney(cost)
      ? row(
          changed ? k.costLabel : hasMoney(d.actual_cost) ? "Actual" : k.costLabel,
          `<strong>${money(cost)}</strong>${
            !changed && hasMoney(d.actual_cost) && hasMoney(d.est_cost) && Number(d.actual_cost) !== Number(d.est_cost)
              ? ` <span style="color:#8b918d">· estimated ${money(d.est_cost)}</span>`
              : ""
          }${Number(d.quantity) > 1 ? ` <span style="color:#8b918d">· ×${Number(d.quantity)}</span>` : ""}`,
        )
      : "") +
    row(changed ? "Changed by" : "Decided by", escapeHtml(d.reviewer_name || "A House Admin"));

  // The House Admin's own words, if they left any — the single most useful part
  // of a denial or an edit, and the reason the note field exists at all.
  const noteBlock = note && String(note).trim()
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0 0"><tr><td style="padding:14px 16px;background:#fbf9f1;border:1px solid #efe8d5;border-radius:10px">
<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8b918d;margin-bottom:6px">Note from ${escapeHtml(
        d.reviewer_name || "the House Admin",
      )}</div>
<div style="font-size:14.5px;line-height:1.6;white-space:pre-wrap">${escapeHtml(note)}</div>
</td></tr></table>`
    : "";

  const orderBlock = d.order_note && String(d.order_note).trim()
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:14px 0 0"><tr><td style="padding:12px 15px;background:#f4f8f5;border-left:3px solid #15503a;border-radius:9px;font-size:13.5px;color:#4a5a52;line-height:1.55;white-space:pre-wrap">${escapeHtml(
        d.order_note,
      )}</td></tr></table>`
    : "";

  // Link-free by design (see the module header) — just says where it lives.
  const whereBlock = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:26px 0 0"><tr><td style="padding:16px 18px;background:#f4f8f5;border:1px solid #dbe7df;border-radius:12px">
<p style="margin:0;font-size:14px;color:#4a5a52;line-height:1.6">The full history for this is in the <strong>MLR app</strong> under <strong>House &rsaquo; Requests</strong>${
    changed && d.status === "pending"
      ? " — it&rsquo;s still waiting on a decision, so speak up there if this isn&rsquo;t what you meant"
      : !changed && d.status === "approved"
        ? ", and you'll hear again once it's actually been bought"
        : ""
  }.</p>
</td></tr></table>`;

  const decider = d.reviewer_name || "A House Admin";
  const didWhat = changed ? "made this change" : "made this decision";
  const title = `<p style="font-size:22px;margin:0 0 4px;line-height:1.25"><strong>${o.emoji} ${escapeHtml(
    d.title || "Your request",
  )}</strong></p>`;
  // Name the decider in the byline, not just in the details table — "who said
  // so" is the first thing anyone wants from a decision, especially a denial.
  const byline = `<p style="margin:0 0 18px;font-size:13px;color:#6b7b73;line-height:1.5">${escapeHtml(
    o.line,
  )} <strong style="color:#14241c">${escapeHtml(decider)}</strong> ${changed ? "made the change" : "made the call"}${
    d.reviewer_email ? " &middot; replies go straight to them" : ""
  }.</p>`;

  const html = shell(
    title,
    `${byline}
<table role="presentation" style="border-collapse:collapse;font-size:14.5px;margin:0">${detailRows}</table>
${noteBlock}
${orderBlock}
${whereBlock}`,
    sentByNote(decider, didWhat, opts.fromAddress, Boolean(d.reviewer_email)),
  );

  const subject = changed
    ? `${o.emoji} Changed: ${d.title || "your request"}`
    : `${o.emoji} ${o.head}: ${d.title || "your request"}`;

  const text = `${o.head.toUpperCase()} — ${d.title || ""}
${o.line}
Type: ${k.label}${hasMoney(cost) ? `\n${hasMoney(d.actual_cost) ? "Actual" : k.costLabel}: ${money(cost)}` : ""}
${changed ? "Changed by" : "Decided by"}: ${decider}${
    note && String(note).trim() ? `\n\nNote: ${note}` : ""
  }${!changed && d.order_note && String(d.order_note).trim() ? `\n${d.order_note}` : ""}

The full history is in the MLR app under House > Requests.

${sentByText(decider, didWhat, opts.fromAddress, Boolean(d.reviewer_email))}

— Muskellunge Lake Resort`;

  return { subject, html, text };
}

/**
 * The co-admin email (migration 0198) → the OTHER House Admins, when one of them
 * acts. Its whole job is answering "who did what to whose request", because a
 * house with several admins otherwise has two people working one queue blind —
 * double-ordering an item, or each assuming the other had it.
 *
 * Deliberately a FYI, not a task: no "you decide this one" block, and it says
 * plainly that nothing is needed from the reader.
 *
 * @param {object} d  a `house_request_notification()` row (post-action)
 * @param {object} [opts]  { fromAddress }
 */
function buildHouseRequestCoadminEmail(d, opts = {}) {
  const k = kindOf(d.kind);
  const actor = d.last_action_by_name || "A House Admin";
  const who = d.requester_name || "a member";
  const houseName = d.house_name || "MLR";
  const cost = hasMoney(d.actual_cost) ? d.actual_cost : d.est_cost;

  const VERB = {
    approved: { emoji: "✅", past: "approved" },
    denied: { emoji: "🚫", past: "turned down" },
    ordered: { emoji: "📦", past: "ordered" },
    received: d.kind === "reimbursement" ? { emoji: "💵", past: "paid" } : { emoji: "🎉", past: "marked as here" },
    changed: { emoji: "✏️", past: "changed" },
  };
  const v = VERB[d.last_action] || VERB.approved;
  // The note the actor left, whichever kind of action it was — the most useful
  // line for a co-admin trying to understand a call they weren't part of.
  const note = d.last_action === "changed" ? d.change_note : d.review_note;

  const detailRows =
    row("What", `<strong>${escapeHtml(d.title || "")}</strong>`) +
    row("Asked for by", escapeHtml(who)) +
    row("House", escapeHtml(houseName)) +
    row("Type", `${k.emoji} ${escapeHtml(k.label)}`) +
    (hasMoney(cost)
      ? row(hasMoney(d.actual_cost) ? "Actual" : k.costLabel, `<strong>${money(cost)}</strong>`)
      : "") +
    row("Now", `<strong>${v.emoji} ${escapeHtml(v.past)}</strong> by ${escapeHtml(actor)}`);

  const noteBlock = note && String(note).trim()
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0 0"><tr><td style="padding:14px 16px;background:#fbf9f1;border:1px solid #efe8d5;border-radius:10px">
<div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8b918d;margin-bottom:6px">${escapeHtml(
        actor,
      )} said</div>
<div style="font-size:14.5px;line-height:1.6;white-space:pre-wrap">${escapeHtml(note)}</div>
</td></tr></table>`
    : "";

  const fyiBlock = `<table role="presentation" style="width:100%;border-collapse:collapse;margin:26px 0 0"><tr><td style="padding:16px 18px;background:#f4f8f5;border:1px solid #dbe7df;border-radius:12px">
<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#14241c;line-height:1.4">Nothing needed from you.</p>
<p style="margin:0;font-size:14px;color:#4a5a52;line-height:1.6">This is just so the House Admins all know where things stand${
    d.last_action === "approved" ? " — somebody still has to actually buy it" : ""
  }. The full list is in the <strong>MLR app</strong> under <strong>House &rsaquo; Requests</strong>.</p>
</td></tr></table>`;

  const title = `<p style="font-size:22px;margin:0 0 4px;line-height:1.25"><strong>${v.emoji} ${escapeHtml(
    actor,
  )} ${escapeHtml(v.past)} ${escapeHtml(who)}&rsquo;s ${escapeHtml(k.label.toLowerCase())}</strong></p>`;
  const byline = `<p style="margin:0 0 18px;font-size:13px;color:#6b7b73;line-height:1.5">You&rsquo;re getting this because you&rsquo;re a House Admin for <strong style="color:#14241c">${escapeHtml(
    houseName,
  )}</strong>.</p>`;

  const html = shell(
    title,
    `${byline}
<table role="presentation" style="border-collapse:collapse;font-size:14.5px;margin:0">${detailRows}</table>
${noteBlock}
${fyiBlock}`,
    sentByNote(actor, `${v.past} this`, opts.fromAddress, false),
  );

  const subject = `${v.emoji} ${actor} ${v.past} ${who}'s ${k.label.toLowerCase()} — ${d.title || ""}`;

  const text = `${actor.toUpperCase()} ${v.past.toUpperCase()} ${who.toUpperCase()}'S ${k.label.toUpperCase()}
What: ${d.title || ""}
Asked for by: ${who}
House: ${houseName}${hasMoney(cost) ? `\n${hasMoney(d.actual_cost) ? "Actual" : k.costLabel}: ${money(cost)}` : ""}
Now: ${v.past} by ${actor}${note && String(note).trim() ? `\n\n${actor} said: ${note}` : ""}

NOTHING NEEDED FROM YOU.
This is just so the House Admins all know where things stand${
    d.last_action === "approved" ? " — somebody still has to actually buy it" : ""
  }. The full list is in the MLR app under House > Requests.

${sentByText(actor, `${v.past} this`, opts.fromAddress, false)}

— Muskellunge Lake Resort`;

  return { subject, html, text };
}

module.exports = {
  buildHouseRequestEmail,
  buildHouseRequestDecisionEmail,
  buildHouseRequestCoadminEmail,
  escapeHtml,
  money,
};
