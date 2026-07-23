"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TournamentBracket } from "@/components/TournamentBracket";
import { TournamentSetupSheet } from "@/components/TournamentSetupSheet";
import { MatchResultSheet, labelForMatch } from "@/components/MatchResultSheet";
import { useTournament } from "@/lib/hooks";
import { useGuest } from "@/components/Guard";
import { swapMatchEntrants, type Tournament, type TournamentMatch } from "@/lib/tournaments";

// A tournament attaches to a real DB activity (fest_schedule_items, a uuid) — the
// only kind that can carry sign-ups. In-code SEED schedule events have slug ids
// (e.g. "ye-olde-family-faire") with no DB row, so we never mount there.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The tournament block on an activity detail page. Lists the activity's
 * tournament(s) (usually one), shows the live bracket to everyone, and gives
 * managers the set-up / scoring controls. Guests get a sign-in nudge.
 */
export function TournamentSection({
  scheduleItemId,
  canManage,
  itemTitle,
}: {
  scheduleItemId: string;
  canManage: boolean;
  itemTitle: string;
}) {
  const guest = useGuest();
  const isDbItem = UUID_RE.test(scheduleItemId);
  const { tournaments, loading, recordResult, reload } = useTournament(guest || !isDbItem ? null : scheduleItemId);
  const [creating, setCreating] = useState(false);

  // Seed (slug-id) activities have no DB row to hang a tournament on.
  if (!isDbItem) return null;

  if (guest) {
    return (
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">🏆 Tournament</h2>
        <p className="mt-1 text-sm text-foreground/60">Sign in to see the bracket and scores.</p>
      </section>
    );
  }

  // Nothing yet: managers can start one; others see nothing (no empty box).
  if (!loading && tournaments.length === 0) {
    if (!canManage) return null;
    return (
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">🏆 Tournament</h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="mt-2 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
        >
          Set up a tournament
        </button>
        {creating && (
          <TournamentSetupSheet
            tournament={null}
            scheduleItemId={scheduleItemId}
            itemTitle={itemTitle}
            onChanged={reload}
            onClose={() => setCreating(false)}
          />
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {tournaments.map((t) => (
        <TournamentCard key={t.id} tournament={t} canManage={canManage} recordResult={recordResult} reload={reload} />
      ))}
      {creating && (
        <TournamentSetupSheet
          tournament={null}
          scheduleItemId={scheduleItemId}
          itemTitle={itemTitle}
          onChanged={reload}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function TournamentCard({
  tournament,
  canManage,
  recordResult,
  reload,
}: {
  tournament: Tournament;
  canManage: boolean;
  recordResult: (matchId: string, winnerId: string, s1?: number | null, s2?: number | null) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"now" | "bracket">("now");
  const [managing, setManaging] = useState(false);
  const [openMatch, setOpenMatch] = useState<TournamentMatch | null>(null);
  const [rearranging, setRearranging] = useState(false);
  const [selected, setSelected] = useState<{ matchId: string; slot: 1 | 2 } | null>(null);

  const onSlotTap = async (m: TournamentMatch, slot: 1 | 2) => {
    const entrantHere = slot === 1 ? m.slot1EntrantId : m.slot2EntrantId;
    if (!selected) {
      // First tap must pick up an entrant (can't move an empty slot).
      if (entrantHere) setSelected({ matchId: m.id, slot });
      return;
    }
    if (selected.matchId === m.id && selected.slot === slot) {
      setSelected(null); // tapped the same slot — cancel
      return;
    }
    const src = selected;
    setSelected(null);
    // swap works for both move-into-empty and swap-two (a null just moves over).
    await swapMatchEntrants(src.matchId, src.slot, m.id, slot);
    await reload();
  };

  const nameFor = useMemo(() => {
    const map = new Map(tournament.entrants.map((e) => [e.id, e.displayName]));
    return (id: string | null) => (id ? map.get(id) ?? "—" : "—");
  }, [tournament.entrants]);

  const isSetup = tournament.status === "setup";
  const isComplete = tournament.status === "complete";
  const champion = isComplete && tournament.winnerEntrantId ? nameFor(tournament.winnerEntrantId) : null;

  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">🏆 Tournament</h2>
          <p className="mt-0.5 font-semibold leading-tight">{tournament.title}</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setManaging(true)}
            className="shrink-0 rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-border"
          >
            {isSetup ? "Set up" : "Manage"}
          </button>
        )}
      </div>

      {champion && (
        <div className="mt-3 rounded-2xl bg-primary/10 p-4 text-center ring-1 ring-primary/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Champion</p>
          <p className="mt-0.5 text-lg font-bold">🥇 {champion}</p>
        </div>
      )}

      {isSetup ? (
        <p className="mt-3 text-sm text-foreground/60">
          {canManage ? "Pull in sign-ups and generate the bracket to get started." : "The bracket hasn't been posted yet — check back soon."}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {!isComplete && (
            <SegmentedControl<"now" | "bracket">
              size="sm"
              segments={[
                { value: "now", label: "Now" },
                { value: "bracket", label: "Bracket" },
              ]}
              value={tab}
              onChange={setTab}
            />
          )}
          {tab === "now" && !isComplete ? (
            <NowView tournament={tournament} nameFor={nameFor} />
          ) : (
            <>
              {canManage && (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setRearranging((v) => !v);
                      setSelected(null);
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                      rearranging ? "bg-accent/10 text-accent ring-accent/30" : "text-foreground/60 ring-border"
                    }`}
                  >
                    {rearranging ? "Done rearranging" : "⇄ Rearrange"}
                  </button>
                  {rearranging && (
                    <span className="text-[11px] text-foreground/50">
                      {selected ? "Tap a spot to move/swap" : "Tap a team to move it"}
                    </span>
                  )}
                </div>
              )}
              <TournamentBracket
                tournament={tournament}
                nameFor={nameFor}
                canManage={canManage}
                onOpenMatch={(m) => setOpenMatch(m)}
                rearranging={rearranging}
                selected={selected}
                onSlotTap={onSlotTap}
              />
            </>
          )}
        </div>
      )}

      {managing && (
        <TournamentSetupSheet
          tournament={tournament}
          scheduleItemId={tournament.scheduleItemId}
          itemTitle={tournament.title}
          onChanged={reload}
          onClose={() => setManaging(false)}
        />
      )}
      {openMatch && (
        <MatchResultSheet
          tournament={tournament}
          match={tournament.matches.find((m) => m.id === openMatch.id) ?? openMatch}
          nameFor={nameFor}
          onRecord={recordResult}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </section>
  );
}

/** Scroll-free spectator summary: what's playable now + what just finished. */
function NowView({ tournament, nameFor }: { tournament: Tournament; nameFor: (id: string | null) => string }) {
  const ready = tournament.matches.filter((m) => m.status === "ready");
  const recent = tournament.matches
    .filter((m) => m.status === "complete" && m.slot1EntrantId && m.slot2EntrantId)
    .slice(-4)
    .reverse();

  if (ready.length === 0 && recent.length === 0) {
    return <p className="text-sm text-foreground/60">No games yet — the bracket is set and ready to start.</p>;
  }

  return (
    <div className="space-y-3">
      {ready.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">Ready to play</p>
          <ul className="space-y-1.5">
            {ready.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
                <span className="truncate text-sm">{nameFor(m.slot1EntrantId)} <span className="text-foreground/30">vs</span> {nameFor(m.slot2EntrantId)}</span>
                <span className="shrink-0 text-[10px] font-medium text-foreground/40">{labelForMatch(tournament, m)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">Recent results</p>
          <ul className="space-y-1.5">
            {recent.map((m) => {
              const w = m.winnerEntrantId;
              const hasScore = m.slot1Score != null && m.slot2Score != null;
              return (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 ring-1 ring-border">
                  <span className="truncate text-sm">
                    <span className="font-semibold">{nameFor(w)}</span>
                    <span className="text-foreground/40"> beat </span>
                    {nameFor(w === m.slot1EntrantId ? m.slot2EntrantId : m.slot1EntrantId)}
                  </span>
                  {hasScore && (
                    <span className="shrink-0 text-xs font-bold tabular-nums">
                      {Math.max(m.slot1Score!, m.slot2Score!)}–{Math.min(m.slot1Score!, m.slot2Score!)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
