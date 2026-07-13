"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchPolls, type Poll } from "@/lib/polls";

/**
 * Stale-while-revalidate cache so returning to Home paints the card instantly
 * instead of a self-hide flash while it refetches (mirrors myHouseCardCache in
 * HouseHubCard.tsx). Keyed by viewer identity + previewAs; memory-only and only
 * ever written after a client fetch, so a cold/SSR render still starts null.
 */
const activePollCardCache = new Map<string, Poll | null>();

/**
 * Compact Home card for the family polls feature (migration 0084): the newest
 * open poll's question + how many votes are in so far, linking straight to
 * /polls to vote or see results. Self-hides for guests, with no open poll, and
 * with no backend — `fetchPolls()` already degrades to `[]` for guests (RLS),
 * an unconfigured Supabase client, and a missing 0084 table (42P01), so "no
 * open poll" covers all of those without any extra checks here.
 */
export function ActivePollCard() {
  const { user, previewAsId } = useIdentity();
  const key = `${user?.email ?? ""}|${previewAsId ?? "self"}`;
  const [poll, setPoll] = useState<Poll | null>(
    activePollCardCache.has(key) ? activePollCardCache.get(key)! : null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPoll(null);
      return;
    }
    fetchPolls()
      .then((rows) => {
        if (cancelled) return;
        // Newest first already (fetchPolls orders by created_at desc) — the
        // first open one is the newest open poll.
        const open = rows.find((p) => !p.isClosed) ?? null;
        setPoll(open);
        activePollCardCache.set(key, open);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, key]);

  if (!poll) return null;

  return (
    <Link
      href="/polls"
      className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border"
    >
      <span
        aria-hidden
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-2xl"
      >
        🗳️
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{poll.question}</p>
        <p className="mt-0.5 text-xs text-foreground/55">
          {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"} so far
        </p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-primary">Vote now →</span>
    </Link>
  );
}
