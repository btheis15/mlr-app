"use client";

import { useMemo, useState } from "react";
import { fetchHouses } from "@/lib/houses";
import type { House } from "@/lib/types";
import {
  ageLabel,
  requestGroup,
  summarize,
  type HouseRequest,
  type HouseRequestGroup,
} from "@/lib/houseRequests";
import { useAllHouseRequests, useDeepLinkFlash, useUrlParam } from "@/lib/hooks";
import { useCachedResource } from "@/lib/swrCache";
import { isSupabaseConfigured } from "@/lib/supabase";
import { formatMoney, plural } from "@/lib/format";
import { SkeletonList } from "@/components/Skeleton";
import { MigrationHint } from "@/components/MigrationHint";
import { HouseRequestCard, ProgressActions, ReviewActions } from "@/components/HouseRequestCard";
import { HouseRequestSheet } from "@/components/HouseRequestSheet";
import { HouseRequestComposer } from "@/components/HouseRequestComposer";
import { AnimatedNumber } from "@/components/AnimatedNumber";

/**
 * The reviewer's queue (migration 0195) — /admin/house-requests for app admins,
 * across every house.
 *
 * Ordered the way the job is actually done, NOT newest-first:
 *
 *   ① Waiting on you        — oldest first, with an age badge. Something that's
 *                             sat for a week is more urgent than today's.
 *   ② Approved, not bought  — the "we only ever come up with ideas" gap. This is
 *                             the section that exists because approving and then
 *                             forgetting is the real failure mode.
 *   ③ Ordered — on the way
 *   ④ Done & denied         — collapsed history (the "🕘 Previously sent" idiom
 *                             from AdminScheduledBroadcasts).
 *
 * Every pending card carries its own Approve / Modify / Deny controls inline, so
 * a stack of requests from six different people can be worked top to bottom
 * without opening a single one.
 */
export function AdminHouseRequests() {
  const { requests, loading, canReview, reload } = useAllHouseRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<HouseRequest | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const deepLinkId = useUrlParam("request");
  const flashId = useDeepLinkFlash("request-", deepLinkId, !loading);

  // House names, so a cross-house queue says which house each row belongs to.
  const { data: houses } = useCachedResource<House[]>(
    isSupabaseConfigured ? "housesForRequests" : null,
    [],
    fetchHouses,
    { persist: "local" },
  );
  const houseName = useMemo(() => new Map(houses.map((h) => [h.id, h.name])), [houses]);

  const summary = useMemo(() => summarize(requests), [requests]);

  const groups = useMemo(() => {
    const by: Record<HouseRequestGroup, HouseRequest[]> = { waiting: [], toDo: [], moving: [], done: [] };
    for (const r of requests) by[requestGroup(r)].push(r);
    // Oldest first in the queue — the opposite of the newest-first list
    // everywhere else, because "this has been sitting for 9 days" is the signal.
    by.waiting.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    by.toDo.sort((a, b) => (a.reviewedAt ?? a.createdAt).localeCompare(b.reviewedAt ?? b.createdAt));
    return by;
  }, [requests]);

  const open = openId ? requests.find((r) => r.id === openId) ?? null : null;

  if (loading) return <SkeletonList count={3} />;

  if (!requests.length) {
    return (
      <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <p className="text-3xl">🧾</p>
        <h2 className="text-base font-bold">No requests yet</h2>
        <p className="text-sm text-muted">
          When someone submits an idea, something to buy, or a reimbursement, it lands here for a decision.
        </p>
        <MigrationHint file="0195_house_requests.sql">To turn requests on,</MigrationHint>
      </div>
    );
  }

  const renderRow = (r: HouseRequest, opts: { age?: boolean } = {}) => (
    <div key={r.id} className={`space-y-2 rounded-2xl ${flashId === r.id ? "ring-2 ring-primary" : ""}`}>
      <HouseRequestCard
        request={r}
        onOpen={() => setOpenId(r.id)}
        showAge={opts.age}
        houseName={r.houseId ? houseName.get(r.houseId) ?? null : "Around the resort"}
      />
      {canReview && r.status === "pending" && (
        <ReviewActions request={r} onDone={reload} onModify={() => setEditing(r)} />
      )}
      {canReview && (r.status === "approved" || r.status === "ordered") && (
        <ProgressActions request={r} onDone={reload} />
      )}
    </div>
  );

  const oldest = groups.waiting[0];

  return (
    <div className="space-y-5">
      {/* Summary strip — what an approver needs before reading a single row. */}
      <div className="grid grid-cols-3 gap-2">
        <Stat value={summary.waiting} label="waiting" hint={oldest ? `oldest ${ageLabel(oldest.createdAt)}` : undefined} />
        <Stat value={summary.notOrdered} label="to buy" hint="approved" />
        <Stat money={summary.approvedThisYear} label="approved" hint={`in ${new Date().getFullYear()}`} />
      </div>

      {groups.waiting.length > 0 && (
        <Section
          title="Waiting on you"
          count={groups.waiting.length}
          note={`${formatMoney(summary.waitingCost)} asked for`}
        >
          {groups.waiting.map((r) => renderRow(r, { age: true }))}
        </Section>
      )}

      {groups.toDo.length > 0 && (
        <Section
          title="Approved — not bought yet"
          count={groups.toDo.length}
          note="nobody has ordered these"
          emphasize
        >
          {groups.toDo.map((r) => renderRow(r))}
        </Section>
      )}

      {groups.moving.length > 0 && (
        <Section title="Ordered — on the way" count={groups.moving.length}>
          {groups.moving.map((r) => renderRow(r))}
        </Section>
      )}

      {groups.done.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            aria-expanded={showHistory}
            className="press flex w-full items-center gap-2 px-0.5 text-xs font-bold uppercase tracking-wide text-faint"
          >
            <span aria-hidden>🕘</span>
            Done &amp; denied ({groups.done.length})
            <span aria-hidden className="ml-auto">
              {showHistory ? "▾" : "▸"}
            </span>
          </button>
          {showHistory && <div className="space-y-2">{groups.done.map((r) => renderRow(r))}</div>}
        </section>
      )}

      {open && (
        <HouseRequestSheet
          request={open}
          canReview={canReview}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onEdit={() => {
            setEditing(open);
            setOpenId(null);
          }}
        />
      )}

      {editing && (
        <HouseRequestComposer
          houseId={editing.houseId ?? ""}
          houseName={editing.houseId ? houseName.get(editing.houseId) ?? "this house" : "the resort"}
          request={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function Stat({
  value,
  money,
  label,
  hint,
}: {
  value?: number;
  money?: number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <p className="text-lg font-bold tabular-nums">
        {money !== undefined ? formatMoney(money) : <AnimatedNumber value={value ?? 0} />}
      </p>
      <p className="text-xs font-medium">{label}</p>
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  count,
  note,
  emphasize = false,
  children,
}: {
  title: string;
  count: number;
  note?: string;
  /** The approved-but-unbought group gets a ring so it can't be skimmed past. */
  emphasize?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`space-y-2 ${emphasize ? "rounded-2xl bg-sun/8 p-3 ring-1 ring-sun/30" : ""}`}>
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-faint">{title}</h2>
        <span className="text-xs text-faint">
          {count} {plural(count, "request")}
        </span>
        {note && <span className="ml-auto text-[11px] text-faint">{note}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
