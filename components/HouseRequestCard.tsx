"use client";

import { useState } from "react";
import {
  KIND_META,
  ageLabel,
  requestCost,
  reviewHouseRequest,
  setHouseRequestProgress,
  statusChip,
  statusLabel,
  type HouseRequest,
} from "@/lib/houseRequests";
import { formatMoney, plural } from "@/lib/format";
import { Avatar } from "@/components/Avatar";

/**
 * One request as a row. Shared by the member board and the admin queue so the
 * two can't drift on how a request reads. `showAge` puts a "3 days" badge on a
 * pending row — used in the reviewer queue, where how long something has sat is
 * the whole point, and left off the member board where it would just nag.
 */
export function HouseRequestCard({
  request,
  onOpen,
  showAge = false,
  houseName,
}: {
  request: HouseRequest;
  onOpen: () => void;
  showAge?: boolean;
  /** Shown in the cross-house admin queue, where one list mixes houses. */
  houseName?: string | null;
}) {
  const meta = KIND_META[request.kind];
  const cost = requestCost(request);
  return (
    <button
      type="button"
      id={`request-${request.id}`}
      onClick={onOpen}
      className="press flex w-full items-start gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border transition-shadow hover:shadow-sm"
    >
      <span
        aria-hidden
        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl ${meta.tile}`}
      >
        {meta.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{request.title}</p>
          {cost !== null && <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(cost)}</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          {request.createdByName}
          {houseName ? ` · ${houseName}` : ""}
          {request.quantity && request.quantity > 1 ? ` · ×${request.quantity}` : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusChip(request.status)}`}>
            {statusLabel(request)}
          </span>
          {showAge && request.status === "pending" && (
            <span className="text-[11px] text-faint">waiting {ageLabel(request.createdAt)}</span>
          )}
          {request.media.length > 0 && (
            <span className="text-[11px] text-faint">
              📎 {request.media.length} {plural(request.media.length, "photo")}
            </span>
          )}
          {request.links.length > 0 && <span className="text-[11px] text-faint">🔗</span>}
        </div>
      </div>
    </button>
  );
}

/**
 * Approve / Deny, with an optional note and an "let them know" email opt-out.
 * Rendered inline on a pending card so a reviewer can work straight down the
 * list without opening anything — that's what makes a queue of ten requests
 * from six people tractable.
 *
 * The in-app notification always fires; the checkbox only governs the EMAIL
 * (migration 0195 pre-stamps the claim column to skip it), because the
 * requester should always have a record of the decision somewhere.
 */
export function ReviewActions({
  request,
  onDone,
  onModify,
}: {
  request: HouseRequest;
  onDone: () => void;
  onModify: () => void;
}) {
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (approve: boolean) => {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { error: err } = await reviewHouseRequest(request.id, approve, note, notify);
    setBusy(null);
    if (err) {
      setError(err);
      return;
    }
    setNote("");
    onDone();
  };

  return (
    <div className="space-y-2 rounded-2xl bg-background p-3 ring-1 ring-border">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional) — they'll see this"
        className="w-full rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => act(true)}
          disabled={busy !== null}
          className="press flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "approve" ? "…" : "Approve"}
        </button>
        <button
          type="button"
          onClick={onModify}
          disabled={busy !== null}
          className="press rounded-xl bg-card px-3 py-2 text-sm font-semibold text-primary ring-1 ring-primary/30 disabled:opacity-50"
        >
          Modify
        </button>
        <button
          type="button"
          onClick={() => act(false)}
          disabled={busy !== null}
          className="press rounded-xl bg-card px-3 py-2 text-sm font-semibold text-accent ring-1 ring-accent/30 disabled:opacity-50"
        >
          {busy === "deny" ? "…" : "Deny"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
        Email them the decision
      </label>
      {error && <p className="text-xs text-accent">{error}</p>}
    </div>
  );
}

/**
 * The second half of the loop: an approved request gets marked ordered, then
 * received (a reimbursement skips straight to paid — 0195 rejects `ordered` for
 * that kind). Optional real cost + a "where from / order #" note, so the board
 * answers "did anyone actually do this" months later.
 */
export function ProgressActions({ request, onDone }: { request: HouseRequest; onDone: () => void }) {
  const isReimbursement = request.kind === "reimbursement";
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(request.actualCost != null ? String(request.actualCost) : "");
  const [orderNote, setOrderNote] = useState(request.orderNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next: "ordered" | "received" =
    isReimbursement || request.status === "ordered" ? "received" : "ordered";
  const label = next === "ordered" ? "Mark ordered" : isReimbursement ? "Mark paid" : "Mark it's here";

  const go = async () => {
    setBusy(true);
    setError(null);
    const parsed = Number.parseFloat(actual.replace(/[^0-9.]/g, ""));
    const { error: err } = await setHouseRequestProgress(
      request.id,
      next,
      Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
      orderNote,
    );
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setOpen(false);
    onDone();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl bg-background p-3 ring-1 ring-border">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>
            $
          </span>
          <input
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            inputMode="decimal"
            placeholder={request.estCost != null ? String(request.estCost) : "What it actually cost"}
            aria-label="What it actually cost"
            className="w-full rounded-xl bg-card py-2 pl-7 pr-3 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
      <input
        value={orderNote}
        onChange={(e) => setOrderNote(e.target.value)}
        placeholder={next === "ordered" ? "Where from / order # (optional)" : "Note (optional)"}
        className="w-full rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="press flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "…" : label}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="press rounded-xl px-3 py-2 text-sm font-semibold text-muted"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-accent">{error}</p>}
    </div>
  );
}

/** Who decided this and what they said — shown once a request has been reviewed. */
export function DecisionNote({ request }: { request: HouseRequest }) {
  if (!request.reviewedAt) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-background p-3 ring-1 ring-border">
      <Avatar name={request.reviewedByName ?? "House Admin"} url={null} size={24} />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-semibold">{request.reviewedByName ?? "A House Admin"}</p>
        <p className="mt-0.5 text-muted">
          {request.reviewNote?.trim() ? `“${request.reviewNote.trim()}”` : statusLabel(request)}
        </p>
      </div>
    </div>
  );
}
