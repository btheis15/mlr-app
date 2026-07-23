"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TournamentBracket, fmtMatchTime } from "@/components/TournamentBracket";
import { TournamentStandings } from "@/components/TournamentStandings";
import { TournamentSetupSheet } from "@/components/TournamentSetupSheet";
import { MatchResultSheet, labelForMatch } from "@/components/MatchResultSheet";
import { useTournament } from "@/lib/hooks";
import { useGuest } from "@/components/Guard";
import {
  swapMatchEntrants,
  generateBracketFromPools,
  poolLabels,
  poolStageComplete,
  hasKnockoutBracket,
  type Tournament,
  type TournamentMatch,
  type TournamentHost,
} from "@/lib/tournaments";

// A fest tournament attaches to a real DB activity (fest_schedule_items, a uuid).
// In-code SEED schedule events have slug ids (e.g. "ye-olde-family-faire") with no
// DB row, so we never mount there. A private-activity host is always a real uuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The tournament block on an activity detail page (a Family Fest activity OR a
 * private activity — see `host`). Lists the activity's tournament(s) (usually
 * one), shows the live bracket to everyone who can see the activity, and gives
 * managers the set-up / scoring controls. Guests get a sign-in nudge.
 */
export function TournamentSection({
  host,
  canManage,
  itemTitle,
  enabled,
}: {
  host: TournamentHost;
  canManage: boolean;
  itemTitle: string;
  /** The activity's `tournamentEnabled` flag — the section only appears when the
   *  organizer turned "🏆 Tournament" on in the activity editor. */
  enabled: boolean;
}) {
  const guest = useGuest();
  const isDbItem = host.kind === "activity" || UUID_RE.test(host.id);
  const active = enabled && isDbItem && !guest;
  const { tournaments, loading, recordResult, reload } = useTournament(active ? host : null);
  const [creating, setCreating] = useState(false);

  // Only on real DB activities the organizer flagged as a tournament — never a
  // seed (slug-id) activity, and never the ones not marked as tournaments.
  if (!isDbItem || !enabled) return null;

  if (guest) {
    return (
      <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">🏆 Tournament</h2>
        <p className="mt-1 text-sm text-foreground/60">Sign in to see the bracket and scores.</p>
      </section>
    );
  }

  // Flagged as a tournament but not built yet: managers get the setup entry
  // point; everyone else sees a quiet placeholder.
  if (!loading && tournaments.length === 0) {
    if (!canManage) {
      return (
        <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">🏆 Tournament</h2>
          <p className="mt-1 text-sm text-foreground/60">Not set up yet — check back soon.</p>
        </section>
      );
    }
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
            host={host}
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
        <TournamentCard key={t.id} tournament={t} host={host} canManage={canManage} recordResult={recordResult} reload={reload} />
      ))}
      {creating && (
        <TournamentSetupSheet
          tournament={null}
          host={host}
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
  host,
  canManage,
  recordResult,
  reload,
}: {
  tournament: Tournament;
  host: TournamentHost;
  canManage: boolean;
  recordResult: (matchId: string, winnerId: string, s1?: number | null, s2?: number | null) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const isRR = tournament.format === "round_robin";
  const isPools = tournament.format === "pools_bracket";
  const [tab, setTab] = useState<string>(isRR ? "standings" : isPools ? "pools" : "now");
  const [advancing, setAdvancing] = useState(false);
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
          {canManage
            ? `Pull in sign-ups and generate the ${isRR ? "schedule" : "bracket"} to get started.`
            : `The ${isRR ? "schedule" : "bracket"} hasn't been posted yet — check back soon.`}
        </p>
      ) : (
        (() => {
          const tabs = isRR
            ? [
                { value: "standings", label: "Standings" },
                { value: "games", label: "Games" },
              ]
            : isPools
              ? [
                  { value: "pools", label: "Pools" },
                  { value: "games", label: "Games" },
                  { value: "bracket", label: "Bracket" },
                ]
              : [
                  { value: "now", label: "Now" },
                  { value: "bracket", label: "Bracket" },
                ];
          // Single-elim collapses to the bracket once complete; round-robin/pools
          // keep their tabs so the final tables stay readable.
          const showTabs = isRR || isPools || !isComplete;
          const effTab = !isRR && !isPools && isComplete ? "bracket" : tab;
          const knockoutReady = hasKnockoutBracket(tournament);
          const canRearrange = effTab === "bracket" && !isRR && (!isPools || knockoutReady);
          return (
            <div className="mt-3 space-y-3">
              {showTabs && (
                <SegmentedControl<string> size="sm" segments={tabs} value={effTab} onChange={setTab} />
              )}

              {effTab === "standings" && (
                <TournamentStandings tournament={tournament} leaderId={tournament.winnerEntrantId} />
              )}

              {effTab === "pools" && (
                <div className="space-y-4">
                  {poolLabels(tournament).map((pl) => (
                    <div key={pl}>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">Pool {pl}</p>
                      <TournamentStandings tournament={tournament} pool={pl} />
                    </div>
                  ))}
                  {canManage && !knockoutReady && poolStageComplete(tournament) && (
                    <button
                      type="button"
                      disabled={advancing}
                      onClick={async () => {
                        setAdvancing(true);
                        await generateBracketFromPools(tournament.id);
                        await reload();
                        setAdvancing(false);
                        setTab("bracket");
                      }}
                      className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      Generate knockout bracket →
                    </button>
                  )}
                  {!knockoutReady && !poolStageComplete(tournament) && (
                    <p className="text-xs text-foreground/50">The knockout bracket seeds once every pool game is played.</p>
                  )}
                </div>
              )}

              {effTab === "now" && !isComplete && <NowView tournament={tournament} nameFor={nameFor} />}

              {effTab === "games" && (
                <TournamentBracket
                  tournament={tournament}
                  nameFor={nameFor}
                  canManage={canManage}
                  onOpenMatch={(m) => setOpenMatch(m)}
                  stageFilter={isPools ? "pool" : undefined}
                />
              )}

              {effTab === "bracket" &&
                (isPools && !knockoutReady ? (
                  <p className="text-sm text-foreground/60">The bracket appears once pool play is done.</p>
                ) : (
                  <>
                    {canManage && canRearrange && (
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
                      stageFilter={isPools ? "bracket" : undefined}
                      rearranging={rearranging && canRearrange}
                      selected={selected}
                      onSlotTap={onSlotTap}
                    />
                  </>
                ))}
            </div>
          );
        })()
      )}

      {managing && (
        <TournamentSetupSheet
          tournament={tournament}
          host={host}
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
                <span className="shrink-0 text-[10px] font-medium text-foreground/40">
                  {m.scheduledAt ? `🕒 ${fmtMatchTime(m.scheduledAt)}` : labelForMatch(tournament, m)}
                </span>
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
