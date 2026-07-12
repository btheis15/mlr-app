"use client";

import { useCallback, useEffect, useState } from "react";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { SignInWall } from "@/components/Guard";
import { useIdentity } from "@/components/IdentityProvider";
import { PollComposer } from "@/components/PollComposer";
import { SkeletonList } from "@/components/Skeleton";
import { useBusyAction, useDebouncedCallback, useSaveStatus } from "@/lib/hooks";
import { applyMyVote, castVote, closePoll, deletePoll, fetchPolls, type Poll } from "@/lib/polls";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

// The /polls screen: the family's voting booth (migration 0084). Open polls
// first (tap an option to vote / change your vote — one vote per member per
// poll), closed polls below with their final results. Any member can start a
// poll; the creator or an admin can close (freeze results) or delete it.
// Results move live via a Realtime subscription on polls + poll_votes; the
// whole screen is members-only (SignInWall — the tables are members-only reads
// under RLS anyway, this just makes the gate friendly).

// Stale-while-revalidate cache so returning to /polls paints instantly instead
// of blanking to a skeleton (mirrors eventsCache / helpRequestsCache in
// lib/hooks.ts). Memory-only, written only after a client fetch — never during
// SSR — so a cold render still starts empty + loading (matches the server HTML).
let pollsCache: Poll[] | null = null;

export function PollsView() {
  return (
    <SignInWall
      title="Polls"
      note="Family polls are for members — add your name & email to see them and vote. No password, just a code we email you."
    >
      <PollsList />
    </SignInWall>
  );
}

function PollsList() {
  const { isAdmin, previewAsId } = useIdentity();
  const [polls, setPolls] = useState<Poll[]>(pollsCache ?? []);
  const [loading, setLoading] = useState(!pollsCache);
  const [composing, setComposing] = useState(false);
  const [schedule] = useDebouncedCallback(250);
  const { busy, run } = useBusyAction();
  const { status, show } = useSaveStatus();

  const reload = useCallback(async () => {
    try {
      const rows = await fetchPolls();
      setPolls(rows);
      pollsCache = rows;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    // Live results: refetch (debounced) whenever a poll or a vote changes.
    // Wrapped so a failed channel join (e.g. the 0084 migration/publication not
    // in place yet) degrades to load-on-open instead of breaking the screen.
    let channel: ReturnType<typeof sb.channel> | null = null;
    try {
      channel = sb
        .channel("polls-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "polls" }, () => schedule(reload))
        .on("postgres_changes", { event: "*", schema: "public", table: "poll_votes" }, () => schedule(reload))
        .subscribe();
    } catch {
      channel = null;
    }
    return () => {
      if (channel) sb.removeChannel(channel);
    };
  }, [reload, schedule]);

  // Tap an option: optimistic (your ✓ + the bars move with the tap), then the
  // RPC confirms; on failure roll back and say so. No-op while an admin is
  // previewing as someone else (writes would land as the real admin).
  const vote = useCallback(
    async (poll: Poll, optionId: string) => {
      if (!isSupabaseConfigured || previewAsId) return;
      if (poll.isClosed || poll.myOptionId === optionId) return;
      const prev = polls;
      const next = polls.map((p) => (p.id === poll.id ? applyMyVote(p, optionId) : p));
      setPolls(next);
      pollsCache = next;
      const { error } = await castVote(poll.id, optionId);
      if (error) {
        setPolls(prev);
        pollsCache = prev;
        show(error);
      } else {
        await reload();
      }
    },
    [polls, previewAsId, reload, show],
  );

  const onClosePoll = (poll: Poll) => {
    if (!window.confirm(`Close "${poll.question}"? Voting stops and the results freeze.`)) return;
    void run(`close-${poll.id}`, async () => {
      const { error } = await closePoll(poll.id);
      if (error) show(error);
      else await reload();
    });
  };

  const onDeletePoll = (poll: Poll) => {
    if (!window.confirm(`Delete "${poll.question}"? This removes everyone's votes for good.`)) return;
    void run(`delete-${poll.id}`, async () => {
      const { error } = await deletePoll(poll.id);
      if (error) show(error);
      else await reload();
    });
  };

  const open = polls.filter((p) => !p.isClosed);
  const closed = polls.filter((p) => p.isClosed);

  return (
    <div className="space-y-4">
      {!isSupabaseConfigured && (
        <ComingSoonCTA
          icon="🗳️"
          title="Polls are coming soon"
          note="You'll be able to ask the family a question and watch the votes roll in right here."
        />
      )}

      {isSupabaseConfigured && (
        <button
          onClick={() => setComposing(true)}
          className="press w-full rounded-2xl bg-primary/10 py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
        >
          + New poll
        </button>
      )}

      {status && <p className="px-0.5 text-sm font-medium text-red-600">{status}</p>}

      {loading ? (
        <SkeletonList />
      ) : polls.length === 0 ? (
        isSupabaseConfigured && (
          <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-3xl" aria-hidden>
              🗳️
            </div>
            <p className="text-sm font-semibold">No polls yet — ask the family something!</p>
            <p className="text-sm text-foreground/60">
              Merch designs, meal choices, picking a date — anything that needs a vote.
            </p>
            <button
              onClick={() => setComposing(true)}
              className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
            >
              Start the first poll
            </button>
          </div>
        )
      ) : (
        <>
          {open.length > 0 && (
            <section className="space-y-3">
              {open.map((p) => (
                <PollCard
                  key={p.id}
                  poll={p}
                  canManage={isAdmin || p.createdByMe}
                  busy={busy}
                  onVote={(optionId) => void vote(p, optionId)}
                  onClosePoll={() => onClosePoll(p)}
                  onDeletePoll={() => onDeletePoll(p)}
                />
              ))}
            </section>
          )}

          {closed.length > 0 && (
            <section className="space-y-3">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">
                Closed polls
              </p>
              {closed.map((p) => (
                <PollCard
                  key={p.id}
                  poll={p}
                  canManage={isAdmin || p.createdByMe}
                  busy={busy}
                  onVote={() => {}}
                  onClosePoll={() => {}}
                  onDeletePoll={() => onDeletePoll(p)}
                />
              ))}
            </section>
          )}
        </>
      )}

      {composing && (
        <PollComposer onClose={() => setComposing(false)} onCreated={reload} />
      )}
    </div>
  );
}

function PollCard({
  poll,
  canManage,
  busy,
  onVote,
  onClosePoll,
  onDeletePoll,
}: {
  poll: Poll;
  canManage: boolean;
  busy: string | null;
  onVote: (optionId: string) => void;
  onClosePoll: () => void;
  onDeletePoll: () => void;
}) {
  const votesLabel = `${poll.totalVotes} ${poll.totalVotes === 1 ? "vote" : "votes"}`;
  const closesLabel =
    !poll.isClosed && poll.closesOn
      ? ` · voting closes ${new Date(`${poll.closesOn}T00:00:00`).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}`
      : "";

  return (
    <article className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold leading-snug">{poll.question}</h2>
        {poll.isClosed && (
          <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-semibold text-foreground/60">
            Closed
          </span>
        )}
      </div>
      <p className="text-xs text-foreground/55">
        {votesLabel}
        {closesLabel}
        {poll.isClosed && " · final results"}
      </p>

      <div className="space-y-2">
        {poll.options.map((o) => {
          const pct = poll.totalVotes ? Math.round((o.votes / poll.totalVotes) * 100) : 0;
          const mine = poll.myOptionId === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={poll.isClosed}
              aria-pressed={mine}
              onClick={() => onVote(o.id)}
              className={`relative w-full overflow-hidden rounded-xl bg-background px-3 py-3 text-left text-sm ring-1 ${
                mine ? "ring-2 ring-primary/50" : "ring-border"
              } ${poll.isClosed ? "" : "press"}`}
            >
              {/* The live % fill — width animates as votes land. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className="min-w-0 font-medium">
                  {mine && (
                    <span aria-label="Your vote" className="mr-1 text-primary">
                      ✓
                    </span>
                  )}
                  {o.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-foreground/55">
                  {o.votes} · {pct}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {!poll.isClosed && !poll.myOptionId && (
        <p className="text-xs text-foreground/50">Tap an option to vote — you can change it any time.</p>
      )}

      {canManage && (
        <div className="flex gap-2 pt-1">
          {!poll.isClosed && (
            <button
              onClick={onClosePoll}
              disabled={busy === `close-${poll.id}`}
              className="press flex-1 rounded-xl bg-background py-2 text-xs font-semibold text-foreground/70 ring-1 ring-border disabled:opacity-50"
            >
              Close poll
            </button>
          )}
          <button
            onClick={onDeletePoll}
            disabled={busy === `delete-${poll.id}`}
            className="press flex-1 rounded-xl bg-background py-2 text-xs font-semibold text-red-600 ring-1 ring-border disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      )}
    </article>
  );
}
