"use client";

import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { useCachedResource } from "@/lib/swrCache";
import { fetchPolls, type Poll } from "@/lib/polls";

/**
 * Compact Home card for the family polls feature (migration 0084): the newest
 * open poll's question + how many votes are in so far, linking straight to
 * /polls to vote or see results. Self-hides for guests, with no open poll, and
 * with no backend — `fetchPolls()` already degrades to `[]` for guests (RLS),
 * an unconfigured Supabase client, and a missing 0084 table (42P01), so "no
 * open poll" covers all of those without any extra checks here.
 *
 * Rides the shared SWR cache (`activePoll.<uid>`, localStorage, 6h TTL) so a
 * cold open paints the card instantly instead of a self-hide flash; the fetch
 * still revalidates, so a closed poll drops off. Admin previews use a
 * preview-scoped, memory-only key.
 */
export function ActivePollCard() {
  const { user, userId, previewAsId } = useIdentity();
  const key =
    user && userId
      ? previewAsId
        ? `activePoll.preview.${previewAsId}`
        : `activePoll.${userId}`
      : null;
  const { data: poll } = useCachedResource<Poll | null>(
    key,
    null,
    // Newest first already (fetchPolls orders by created_at desc) — the first
    // open one is the newest open poll.
    () => fetchPolls().then((rows) => rows.find((p) => !p.isClosed) ?? null),
    { persist: previewAsId ? undefined : "local", ttlMs: 6 * 60 * 60 * 1000 },
  );

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
