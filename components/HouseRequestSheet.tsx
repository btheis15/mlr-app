"use client";

import { useState } from "react";
import {
  KIND_META,
  requestCost,
  statusChip,
  statusLabel,
  toMedia,
  withdrawHouseRequest,
  type HouseRequest,
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
}: {
  request: HouseRequest;
  canReview: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const { previewAsId } = useIdentity();
  const [busy, setBusy] = useState(false);
  const meta = KIND_META[request.kind];
  const cost = requestCost(request);
  // "View as" is strictly read-only — never write as the previewed member.
  const canAct = canReview && !previewAsId;
  const canWithdraw = request.mine && request.status === "pending" && !previewAsId;
  const visibleMedia = request.media.filter((m) => m.status !== "hidden");

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

  const steps: { label: string; at: string | null; done: boolean }[] = [
    { label: "Submitted", at: request.createdAt, done: true },
    ...(request.status === "denied"
      ? [{ label: "Not approved", at: request.reviewedAt, done: true }]
      : request.status === "withdrawn"
        ? [{ label: "Withdrawn", at: request.reviewedAt, done: true }]
        : [
            { label: "Approved", at: request.reviewedAt, done: request.reviewedAt !== null && request.status !== "pending" },
            ...(request.kind === "reimbursement"
              ? []
              : [{ label: "Ordered", at: request.orderedAt, done: request.orderedAt !== null }]),
            {
              label: request.kind === "reimbursement" ? "Paid" : "Here",
              at: request.receivedAt,
              done: request.receivedAt !== null,
            },
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
            {meta.label} from {request.createdByName} · {formatDate(request.createdAt)}
          </p>
        </div>
      }
    >
      {(cost !== null || request.quantity) && (
        <div className="flex items-baseline gap-2 rounded-2xl bg-card p-4 ring-1 ring-border">
          <span className="text-2xl font-bold tabular-nums">{formatMoney(cost)}</span>
          <span className="text-xs text-muted">
            {request.actualCost != null
              ? request.estCost != null && request.actualCost !== request.estCost
                ? `actual · estimated ${formatMoney(request.estCost)}`
                : "actual"
              : request.kind === "reimbursement"
                ? "already spent"
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

      <DecisionNote request={request} />

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
      {canAct && (request.status === "approved" || request.status === "ordered") && (
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
      </div>
    </Sheet>
  );
}
