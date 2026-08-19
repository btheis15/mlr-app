"use client";

import { useEffect, useState } from "react";
import {
  KIND_META,
  canDeleteRequest,
  deleteHouseRequest,
  fetchPayMethods,
  nextStep,
  payPrefillFor,
  requestCost,
  statusChip,
  statusLabel,
  toMedia,
  withdrawHouseRequest,
  type HouseRequest,
  type PayMethods,
} from "@/lib/houseRequests";
import { formatDate, formatMoney } from "@/lib/format";
import { Sheet, SectionLabel } from "@/components/Sheet";
import { MediaGrid } from "@/components/MediaGrid";
import { useSheetDismiss } from "@/lib/hooks";
import { useIdentity } from "@/components/IdentityProvider";
import { DecisionNote, ProgressActions, ReviewActions } from "@/components/HouseRequestCard";

/** "Open on amazon.com" from a bare URL, so an unlabeled link still reads like
 *  a destination rather than a wall of query string. */
function linkLabel(href: string, label: string | null): string {
  if (label?.trim()) return label.trim();
  try {
    return `Open on ${new URL(href).hostname.replace(/^www\./, "")}`;
  } catch {
    return "Open link";
  }
}

/**
 * The full request: why it was asked for, what it links to, the receipt, the
 * decision, and a TIMELINE of what's actually happened — which is the answer to
 * "did anyone ever do this?" that the whole feature exists to provide.
 */
export function HouseRequestSheet({
  request,
  canReview,
  onClose,
  onChanged,
  onEdit,
  onPromote,
  onBuyItMyself,
}: {
  request: HouseRequest;
  canReview: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
  /**
   * "The house agreed — now actually buy it": opens a NEW purchase request seeded
   * from this idea. This is the answer to "so what happens to an idea everyone
   * likes?", and it's what keeps 💡 genuinely distinct from 🛒 rather than a
   * softer way of asking for the same thing.
   */
  onPromote?: () => void;
  /** "They told me to just buy it and they'd pay me back" (0207). */
  onBuyItMyself?: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const { previewAsId } = useIdentity();
  const [busy, setBusy] = useState(false);
  const meta = KIND_META[request.kind];
  const cost = requestCost(request);
  const next = nextStep(request);
  // "View as" is strictly read-only — never write as the previewed member.
  const canAct = canReview && !previewAsId;
  const canWithdraw = request.mine && request.status === "pending" && !previewAsId;
  const visibleMedia = request.media.filter((m) => m.status !== "hidden");

  // ⚠️ On a reimbursement, whoever is paying needs EVERY way this person takes
  // money — not just their preferred one. The payer may only have Zelle, and if
  // the requester also has Zelle they should simply be paid on Zelle. Loaded for
  // the reviewer (who has to act on it) and for the requester themself (so they
  // can see what the payer is looking at); nobody else needs it.
  const showPayTo = request.kind === "reimbursement" && (canReview || request.mine);
  const [pay, setPay] = useState<PayMethods>({ methods: [], resolved: false });
  // The total rides IN the pay link, so Venmo / Cash App / PayPal open with the
  // figure already entered — nobody retypes an amount that's sitting right here,
  // and nobody fat-fingers it. Recomputed when the reviewer corrects the cost.
  const prefill = payPrefillFor(request);
  useEffect(() => {
    if (!showPayTo) return;
    let alive = true;
    fetchPayMethods(request.createdBy, prefill).then((p) => {
      if (alive) setPay(p);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill is derived; key off its values so a corrected cost re-signs the links
  }, [showPayTo, request.createdBy, prefill.amount, prefill.note]);

  const withdraw = async () => {
    if (!window.confirm("Take this request back?")) return;
    setBusy(true);
    const { error } = await withdrawHouseRequest(request.id);
    setBusy(false);
    if (error) {
      window.alert(error);
      return;
    }
    onChanged();
    close();
  };

  // Clearing finished rows / test junk (0201). The confirm is deliberately
  // heavier for a REAL request than a test one — deleting a genuine, already-paid
  // reimbursement throws away the only record that it happened, whereas a test row
  // nobody else could see is pure noise.
  const canDelete = canAct && canDeleteRequest(request);
  const remove = async () => {
    const msg = request.testOnly
      ? `Delete this test request?\n\n"${request.title}"`
      : `Delete "${request.title}" for good?\n\nThis is the record that it happened — once it's gone there's no history of it on the board. Nobody is notified.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    const { error } = await deleteHouseRequest(request.id);
    setBusy(false);
    if (error) {
      window.alert(error);
      return;
    }
    onChanged();
    close();
  };

  const steps: { label: string; at: string | null; done: boolean }[] = [
    { label: "Submitted", at: request.createdAt, done: true },
    ...(request.status === "denied"
      ? [{ label: "Not approved", at: request.reviewedAt, done: true }]
      : request.status === "withdrawn"
        ? [{ label: "Withdrawn", at: request.reviewedAt, done: true }]
        : [
            {
              // An idea isn't "approved" like a spend is — it's agreed to.
              label: request.kind === "idea" ? "The house is up for it" : "Approved",
              at: request.reviewedAt,
              done: request.reviewedAt !== null && request.status !== "pending",
            },
            // ⚠️ A purchase ENDS at Ordered — no "Here" step. Something that's
            // been ordered obviously turns up, and a second box for a House Admin
            // to tick later is just a row nobody ever closes. A reimbursement ends
            // at Paid, which is the moment that matters. An IDEA has no third step
            // at all — nothing gets bought, so agreeing to it is the end of the
            // line, and a permanently-empty "Ordered" circle made a finished idea
            // look like an unfinished errand.
            ...(request.kind === "idea"
              ? []
              : request.kind === "reimbursement"
                ? [{ label: "Paid", at: request.receivedAt, done: request.receivedAt !== null }]
                : [{ label: "Ordered", at: request.orderedAt, done: request.orderedAt !== null }]),
          ]),
  ];

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="house-request-detail-title"
      header={
        <div className="pr-10">
          <div className="flex items-center gap-2">
            <span aria-hidden className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-lg ${meta.tile}`}>
              {meta.emoji}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusChip(request.status)}`}>
              {statusLabel(request)}
            </span>
          </div>
          <h2 id="house-request-detail-title" className="mt-2 text-lg font-bold leading-snug">
            {request.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            <span className={`font-semibold ${meta.text}`}>{meta.label}</span> from {request.createdByName} ·{" "}
            {formatDate(request.createdAt)}
          </p>
        </div>
      }
    >
      {/* ⚠️ The deal, restated on the one screen where somebody decides. Whoever
          opens this — the requester checking on it, or the House Admin about to
          act — needs "whose money, and who does the buying" without inferring it
          from a chip color. `nextStep` names who currently holds the ball. */}
      <div className={`space-y-1.5 rounded-2xl border-l-4 bg-card p-4 ring-1 ring-border ${meta.edge}`}>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}>
            {meta.money}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-foreground/80">{meta.deal}</p>
        {/* ⚠️ Don't let a converted row rewrite its own history. Without this an
            approved reimbursement reads as though it was always a receipt — and
            the approval on it looks like someone approved a spend that had
            already happened, rather than the purchase it actually approved. */}
        {request.convertedFromKind === "purchase" && (
          <p className="text-xs text-muted">
            Started as a purchase request — {request.mine ? "you" : request.createdByName} bought it{" "}
            {request.mine ? "yourself" : "themselves"} instead.
          </p>
        )}
        {next && (
          <p className="text-xs font-semibold text-foreground/70">
            <span aria-hidden>→ </span>
            {next}
          </p>
        )}
      </div>

      {(cost !== null || request.quantity) && (
        <div className="flex items-baseline gap-2 rounded-2xl bg-card p-4 ring-1 ring-border">
          <span className="text-2xl font-bold tabular-nums">{formatMoney(cost)}</span>
          <span className="text-xs text-muted">
            {request.actualCost != null
              ? request.estCost != null && request.actualCost !== request.estCost
                ? `actual · estimated ${formatMoney(request.estCost)}`
                : "actual"
              : request.kind === "reimbursement"
                ? "total spent"
                : "estimated"}
            {request.quantity && request.quantity > 1 ? ` · ×${request.quantity}` : ""}
          </span>
        </div>
      )}

      {request.reason.trim() && (
        <div className="space-y-1.5">
          <SectionLabel>{request.kind === "reimbursement" ? "What it was for" : "Why"}</SectionLabel>
          <p className="whitespace-pre-wrap text-sm text-foreground/80">{request.reason}</p>
        </div>
      )}

      {request.links.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Links</SectionLabel>
          <div className="space-y-2">
            {request.links.map((l, i) => (
              <a
                key={`${l.href}-${i}`}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="press flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 text-sm font-semibold text-primary ring-1 ring-border"
              >
                <span aria-hidden>🔗</span>
                <span className="min-w-0 flex-1 truncate">{linkLabel(l.href, l.label)}</span>
                <span aria-hidden className="shrink-0 text-muted">
                  ↗
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {visibleMedia.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>{request.kind === "reimbursement" ? "Receipt" : "Photos"}</SectionLabel>
          <MediaGrid media={visibleMedia.map(toMedia)} />
          {visibleMedia.some((m) => m.status === "pending") && (
            <p className="text-xs text-faint">One of these is held for review — only you and admins can see it.</p>
          )}
        </div>
      )}

      {/* How to actually pay them. Every registered method, preferred first but
          none hidden — the payer uses whichever they also have. */}
      {showPayTo && pay.resolved && (
        <div className="space-y-1.5">
          <SectionLabel>{request.mine ? "How they'll pay you" : `How to pay ${request.createdByName}`}</SectionLabel>
          {pay.methods.length === 0 ? (
            <p className="rounded-xl bg-background p-3 text-xs text-muted ring-1 ring-border">
              {request.mine
                ? "You haven't added a way to get paid — add one in your profile so they know where to send it."
                : `${request.createdByName} hasn't added a payment method. Ask them how they'd like it.`}
            </p>
          ) : (
            <div className="space-y-2">
              {pay.methods.map((m) => {
                const inner = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{m.label}</span>
                      <span className="block truncate text-xs text-muted">{m.value}</span>
                      {/* Only promised where the amount really is in the link —
                          Zelle has no deep link and Apple Cash can't be pre-filled. */}
                      {m.prefilled && prefill.amount ? (
                        <span className="block text-[11px] font-medium text-primary">
                          opens with {formatMoney(prefill.amount)} filled in
                        </span>
                      ) : (
                        m.note && <span className="block text-[11px] text-faint">{m.note}</span>
                      )}
                    </span>
                    {m.preferred && (
                      <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        prefers this
                      </span>
                    )}
                  </>
                );
                return m.href ? (
                  <a
                    key={m.key}
                    href={m.href}
                    target="_blank"
                    rel="noreferrer"
                    className="press flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border"
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={m.key} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 ring-1 ring-border">
                    {inner}
                  </div>
                );
              })}
              <p className="text-[11px] text-faint">
                {pay.methods.length > 1
                  ? "Any of these work — use whichever you have. “Prefers this” is a preference, not a restriction. "
                  : ""}
                {pay.methods.some((m) => m.prefilled)
                  ? "Double-check the amount in the pay app before you send — we fill it in, we can't send it for you."
                  : ""}
              </p>
            </div>
          )}
        </div>
      )}

      <DecisionNote request={request} />

      {/* ⚠️ "They told me to just grab it." The single most common way this board
          goes stale: a House Admin says in person "easier if you just order it,
          we'll pay you back", and the request is then abandoned rather than
          re-typed as a reimbursement. One tap converts it in place, keeping
          everything already written. Requester only — the payout follows
          `createdBy`, so the person who paid has to be the one to say so. */}
      {onBuyItMyself &&
        request.mine &&
        request.kind === "purchase" &&
        (request.status === "approved" || request.status === "pending") &&
        !previewAsId && (
          <div className="space-y-1.5 rounded-2xl bg-accent/10 p-3">
            <p className="text-xs leading-relaxed text-foreground/80">
              Told to just grab it yourself? Buy it and ask for your money back instead — everything you&rsquo;ve
              already written here comes with it.
            </p>
            <button
              type="button"
              onClick={onBuyItMyself}
              className="press w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
            >
              🧾 I bought it myself — pay me back
            </button>
          </div>
        )}

      {/* The idea's payoff. Open to ANY member of the house (not just reviewers) —
          noticing that an agreed idea is ready to actually buy isn't an admin
          job, and the new request goes through the normal approval anyway. The
          idea itself stays on the board as the record of the conversation. */}
      {onPromote && request.kind === "idea" && request.status === "approved" && !previewAsId && (
        <div className="space-y-1.5 rounded-2xl bg-lake/10 p-3">
          <p className="text-xs leading-relaxed text-foreground/80">
            The house is up for this. Ready to actually buy something for it? Send it on as a purchase request so a
            House Admin can order it.
          </p>
          <button
            type="button"
            onClick={onPromote}
            className="press w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
          >
            🛒 Turn this into a purchase request
          </button>
        </div>
      )}

      {request.orderNote?.trim() && (
        <div className="space-y-1.5">
          <SectionLabel>Order note</SectionLabel>
          <p className="text-sm text-foreground/80">{request.orderNote}</p>
        </div>
      )}

      {/* The timeline. Deliberately always shown, even on a brand-new request —
          seeing the empty steps is what tells a member what happens next. */}
      <div className="space-y-1.5">
        <SectionLabel>Where it&rsquo;s at</SectionLabel>
        <ol className="space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2.5 text-sm">
              <span
                aria-hidden
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  s.done ? "bg-primary text-white" : "bg-foreground/10 text-faint"
                }`}
              >
                {s.done ? "✓" : ""}
              </span>
              <span className={s.done ? "font-medium" : "text-faint"}>{s.label}</span>
              {s.at && s.done && <span className="ml-auto text-xs text-faint">{formatDate(s.at)}</span>}
            </li>
          ))}
        </ol>
      </div>

      {canAct && request.status === "pending" && (
        <ReviewActions request={request} onDone={onChanged} onModify={onEdit} />
      )}
      {/* Only from `approved` — ordered/paid is the end, nothing follows. */}
      {canAct && request.status === "approved" && (
        <ProgressActions request={request} onDone={onChanged} />
      )}

      <div className="flex gap-2 pb-1">
        {(canAct || canWithdraw) && (
          <button
            type="button"
            onClick={onEdit}
            className="press flex-1 rounded-xl bg-card py-2 text-sm font-semibold text-primary ring-1 ring-primary/30"
          >
            Edit details
          </button>
        )}
        {canWithdraw && (
          <button
            type="button"
            onClick={withdraw}
            disabled={busy}
            className="press rounded-xl px-3 py-2 text-sm font-semibold text-accent ring-1 ring-accent/30 disabled:opacity-50"
          >
            Take it back
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="press rounded-xl px-3 py-2 text-sm font-semibold text-accent ring-1 ring-accent/30 disabled:opacity-50"
          >
            {request.testOnly ? "Delete test" : "Delete"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
