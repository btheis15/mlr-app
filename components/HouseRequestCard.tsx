"use client";

import { useEffect, useState } from "react";
import {
  KIND_META,
  ageLabel,
  decideLabels,
  fetchHouseAdmins,
  nextStep,
  requestCost,
  reviewHouseRequest,
  setHouseRequestProgress,
  statusChip,
  statusLabel,
  tombstoneLabel,
  type HouseAdmin,
  type HouseRequest,
} from "@/lib/houseRequests";
import { formatMoney, plural } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { useIdentity } from "@/components/IdentityProvider";

/**
 * "Who hears about this if I act?" — resolved and NAMED before any reviewer
 * action, because a decision also fans a co-admin notice out to the other House
 * Admins (migration 0198) and that audience was previously invisible in the UI.
 *
 * Reads `profiles.house_admin` for the request's own house — the same predicate
 * the server-side fan-out uses (0199) — so this can't drift from reality. The
 * requester and the acting admin are filtered out here exactly as the server
 * filters them.
 */
function useCoAdmins(request: HouseRequest): HouseAdmin[] | null {
  const { userId } = useIdentity();
  const [all, setAll] = useState<HouseAdmin[] | null>(null);
  useEffect(() => {
    if (!request.houseId) {
      setAll([]);
      return;
    }
    let alive = true;
    fetchHouseAdmins(request.houseId).then((a) => {
      if (alive) setAll(a);
    });
    return () => {
      alive = false;
    };
  }, [request.houseId]);
  if (all === null) return null;
  return all.filter((a) => a.id !== userId && a.id !== request.createdBy);
}

/** The one-line "and this tells…" disclosure shared by both action panels. */
function TellsLine({ who, requesterName }: { who: HouseAdmin[] | null; requesterName: string }) {
  if (who === null) return null;
  return (
    <p className="text-[11px] text-faint">
      <span className="font-semibold">Tells:</span> {requesterName}
      {who.length > 0 ? `, and ${who.map((a) => a.name).join(", ")}` : ""}
      {who.length > 0 ? ` (${plural(who.length, "the other House Admin", "the other House Admins")})` : " — nobody else"}
    </p>
  );
}

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
  const next = nextStep(request);
  return (
    <button
      type="button"
      id={`request-${request.id}`}
      onClick={onOpen}
      // ⚠️ The colored left edge + the kind line below are what make three
      // requests on one board read as three DIFFERENT things. A small emoji tile
      // alone was the entire distinction before, and it wasn't one.
      className={`press flex w-full items-start gap-3 rounded-2xl border-l-4 bg-card p-4 text-left ring-1 ring-border transition-shadow hover:shadow-sm ${meta.edge}`}
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
        {/* What kind it is AND whose money — on every row, never inferred from a
            color. An amount with no label reads as "somebody spent this". */}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
          <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
          <span className="text-faint">·</span>
          <span className="text-muted">{meta.money}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {request.createdByName}
          {houseName ? ` · ${houseName}` : ""}
          {request.quantity && request.quantity > 1 ? ` · ×${request.quantity}` : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* A test submission (0200) — only its author was notified and only
              they + app admins can see it. Badged first so it reads as a test
              before anything else on the row does. */}
          {request.testOnly && (
            <span className="rounded-full bg-dusk/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-dusk">
              Test
            </span>
          )}
          {/* A removed request stays put for 7 days saying WHO removed it — so
              anyone hunting for it can tell "somebody took it back" from "it was
              never submitted", which is the confusion this exists to prevent. */}
          {request.deletedAt && (
            <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-semibold text-muted">
              {tombstoneLabel(request)}
            </span>
          )}
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
        {/* "→ A House Admin still has to order it" — the ball, named, on the row.
            The whole failure mode here is everyone assuming somebody else has it. */}
        {next && (
          <p className="mt-1 text-[11px] font-medium text-foreground/70">
            <span aria-hidden>→ </span>
            {next}
          </p>
        )}
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
  const coAdmins = useCoAdmins(request);
  const meta = KIND_META[request.kind];
  const verbs = decideLabels(request.kind);

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
      {/* ⚠️ What approving actually COMMITS THIS ADMIN TO, before they tap it.
          "Approve" on its own never said that ordering the thing was now their
          job — which is precisely how an approved request sat unbought. */}
      <p className="text-[11px] leading-relaxed text-muted">
        <span className={`font-semibold ${meta.text}`}>{meta.money}.</span> If you approve: {meta.adminDoes}
      </p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional) — they'll see this"
        className="w-full rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
      {/* Approve gets its own full-width row: the verb names the follow-through
          ("Approve — I'll order it"), which doesn't fit three-to-a-row. */}
      <button
        type="button"
        onClick={() => act(true)}
        disabled={busy !== null}
        className="press w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy === "approve" ? "…" : verbs.approve}
      </button>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onModify}
          disabled={busy !== null}
          className="press flex-1 rounded-xl bg-card px-3 py-2 text-sm font-semibold text-primary ring-1 ring-primary/30 disabled:opacity-50"
        >
          Change it first
        </button>
        <button
          type="button"
          onClick={() => act(false)}
          disabled={busy !== null}
          className="press flex-1 rounded-xl bg-card px-3 py-2 text-sm font-semibold text-accent ring-1 ring-accent/30 disabled:opacity-50"
        >
          {busy === "deny" ? "…" : verbs.deny}
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
        Email {request.createdByName} the decision
      </label>
      <TellsLine who={coAdmins} requesterName={request.createdByName} />
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
  const coAdmins = useCoAdmins(request);
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(request.actualCost != null ? String(request.actualCost) : "");
  const [orderNote, setOrderNote] = useState(request.orderNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ ONE forward step, and only from `approved`. A purchase ends at Ordered and
  // a reimbursement ends at Paid — there is no follow-up box to tick, so once a
  // request has moved there's nothing left to render here at all.
  //
  // ⚠️ AN IDEA HAS NO FORWARD STEP. Nothing is bought and nothing is paid, so
  // "Mark ordered" on an agreed idea was an action with no meaning that left the
  // row looking unfinished forever. Agreeing to it IS the end (see statusLabel /
  // requestGroup, which now treat an approved idea as done).
  const next: "ordered" | "received" | null =
    request.status !== "approved" || request.kind === "idea" ? null : isReimbursement ? "received" : "ordered";
  const label = next === "received" ? "Mark it paid" : "Mark it ordered";

  const go = async () => {
    if (!next) return;
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

  // Nothing further to do — it's ordered (or paid), which is the end.
  if (!next) return null;

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
      <TellsLine who={coAdmins} requesterName={request.createdByName} />
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
