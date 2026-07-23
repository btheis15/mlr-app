"use client";

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/SegmentedControl";
import type { Tournament, TournamentMatch } from "@/lib/tournaments";

/**
 * The bracket, rendered a round at a time (a SegmentedControl pager) so one round
 * fits a phone viewport without horizontal scrolling — the recommended primary
 * view. Managers get a tap-to-score affordance on ready/decided matches; everyone
 * else sees the same cards read-only.
 */
export function TournamentBracket({
  tournament,
  nameFor,
  canManage,
  onOpenMatch,
  rearranging = false,
  selected = null,
  onSlotTap,
  stageFilter,
  poolFilter = null,
}: {
  tournament: Tournament;
  nameFor: (entrantId: string | null) => string;
  canManage: boolean;
  onOpenMatch: (m: TournamentMatch) => void;
  /** When true, tapping a slot selects/moves an entrant instead of scoring. */
  rearranging?: boolean;
  /** The currently picked-up slot (first tap), highlighted. */
  selected?: { matchId: string; slot: 1 | 2 } | null;
  /** A slot was tapped in rearrange mode. */
  onSlotTap?: (match: TournamentMatch, slot: 1 | 2) => void;
  /** Show only matches of this stage (e.g. 'bracket' for a pools knockout). */
  stageFilter?: "pool" | "bracket";
  /** Show only matches in this pool. */
  poolFilter?: string | null;
}) {
  const shown = useMemo(
    () =>
      tournament.matches.filter(
        (m) => (!stageFilter || m.stage === stageFilter) && (poolFilter == null || m.pool === poolFilter),
      ),
    [tournament.matches, stageFilter, poolFilter],
  );
  const rounds = useMemo(
    () => Array.from(new Set(shown.map((m) => m.round))).sort((a, b) => a - b),
    [shown],
  );
  // No "final/SF" labels when nothing progresses (round-robin / pool games).
  const numberedOnly = shown.every((m) => !m.nextMatchId);

  // Default the pager to the earliest round that still has an undecided match
  // (where the action is), else the last round.
  const firstLive = useMemo(() => {
    for (const r of rounds) {
      if (shown.some((m) => m.round === r && m.status !== "complete" && m.slot1EntrantId && m.slot2EntrantId)) {
        return r;
      }
    }
    return rounds[rounds.length - 1] ?? 1;
  }, [rounds, shown]);

  const [round, setRound] = useState<number>(firstLive);
  const activeRound = rounds.includes(round) ? round : firstLive;

  const maxRound = rounds[rounds.length - 1] ?? 1;
  const matches = shown.filter((m) => m.round === activeRound).sort((a, b) => a.position - b.position);

  if (rounds.length === 0) return null;

  return (
    <div className="space-y-3">
      {rounds.length > 1 && (
        <SegmentedControl<string>
          size="sm"
          segments={rounds.map((r) => ({ value: String(r), label: shortRoundLabel(numberedOnly, r, maxRound) }))}
          value={String(activeRound)}
          onChange={(v) => setRound(Number(v))}
        />
      )}
      <div className="space-y-2.5">
        {matches.map((m) => (
          <BracketMatchCard
            key={m.id}
            match={m}
            nameFor={nameFor}
            canManage={canManage}
            onOpen={() => onOpenMatch(m)}
            rearranging={rearranging}
            selected={selected}
            onSlotTap={onSlotTap}
          />
        ))}
      </div>
    </div>
  );
}

function BracketMatchCard({
  match,
  nameFor,
  canManage,
  onOpen,
  rearranging = false,
  selected = null,
  onSlotTap,
}: {
  match: TournamentMatch;
  nameFor: (id: string | null) => string;
  canManage: boolean;
  onOpen: () => void;
  rearranging?: boolean;
  selected?: { matchId: string; slot: 1 | 2 } | null;
  onSlotTap?: (match: TournamentMatch, slot: 1 | 2) => void;
}) {
  const bye = (!!match.slot1EntrantId) !== (!!match.slot2EntrantId) && match.status === "complete";
  const bothSet = !!match.slot1EntrantId && !!match.slot2EntrantId;
  const tappable = !rearranging && canManage && (bothSet || match.status === "complete") && !bye;

  const row = (entrantId: string | null, score: number | null, slot: 1 | 2) => {
    const isWinner = !!match.winnerEntrantId && entrantId === match.winnerEntrantId;
    const label = entrantId ? nameFor(entrantId) : match.status === "complete" ? "Bye" : "TBD";
    const isSelected = rearranging && selected?.matchId === match.id && selected?.slot === slot;
    const body = (
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 ${
          isSelected ? "bg-accent/15" : isWinner ? "bg-primary/10" : ""
        }`}
      >
        <span
          className={`truncate text-sm ${
            entrantId ? (isWinner ? "font-semibold" : "") : "text-foreground/40"
          }`}
        >
          {label}
        </span>
        {rearranging ? (
          entrantId && <span className="text-xs text-accent">{isSelected ? "moving…" : "move"}</span>
        ) : (
          score != null && <span className="text-sm font-bold tabular-nums">{score}</span>
        )}
      </div>
    );
    if (rearranging && canManage) {
      return (
        <button type="button" onClick={() => onSlotTap?.(match, slot)} className="block w-full text-left">
          {body}
        </button>
      );
    }
    return body;
  };

  const Tag = tappable ? "button" : "div";
  return (
    <Tag
      {...(tappable ? { type: "button" as const, onClick: onOpen } : {})}
      className={`block w-full overflow-hidden rounded-2xl text-left ring-1 ${
        rearranging ? "ring-accent/40" : "ring-border"
      } ${tappable ? "hover:ring-foreground/25" : ""} ${bye ? "opacity-70" : ""}`}
    >
      {row(match.slot1EntrantId, match.slot1Score, 1)}
      <div className="h-px bg-border" />
      {row(match.slot2EntrantId, match.slot2Score, 2)}
      {(match.isPlayIn || match.status === "ready" || match.scheduledAt) && (
        <div className="flex items-center justify-between gap-2 bg-card px-3 py-1">
          <span className="flex items-center gap-2">
            {match.isPlayIn && <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">Play-in</span>}
            {!match.isPlayIn && match.status === "ready" && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Ready</span>
            )}
            {match.scheduledAt && match.status !== "complete" && (
              <span className="text-[10px] font-medium text-foreground/50">🕒 {fmtMatchTime(match.scheduledAt)}</span>
            )}
          </span>
          {tappable && match.status !== "complete" && (
            <span className="text-[10px] font-medium text-foreground/40">Tap to score</span>
          )}
        </div>
      )}
    </Tag>
  );
}

/** A scheduled match time as a short local clock label ("3:15 PM"). */
export function fmtMatchTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Short pager label: Play-in / QF / SF / Final / R{n}. */
function shortRoundLabel(numberedOnly: boolean, round: number, maxRound: number): string {
  // Round-robin / pool games (no progression pointers): just numbered rounds.
  if (numberedOnly) return `R${round}`;
  const fromFinal = maxRound - round;
  if (fromFinal === 0) return "Final";
  if (fromFinal === 1) return "SF";
  if (fromFinal === 2) return "QF";
  return `R${round}`;
}
