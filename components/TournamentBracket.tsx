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
}: {
  tournament: Tournament;
  nameFor: (entrantId: string | null) => string;
  canManage: boolean;
  onOpenMatch: (m: TournamentMatch) => void;
}) {
  const rounds = useMemo(() => {
    const set = Array.from(new Set(tournament.matches.map((m) => m.round))).sort((a, b) => a - b);
    return set;
  }, [tournament.matches]);

  // Default the pager to the earliest round that still has an undecided match
  // (where the action is), else the final.
  const firstLive = useMemo(() => {
    for (const r of rounds) {
      if (tournament.matches.some((m) => m.round === r && m.status !== "complete" && m.slot1EntrantId && m.slot2EntrantId)) {
        return r;
      }
    }
    return rounds[rounds.length - 1] ?? 1;
  }, [rounds, tournament.matches]);

  const [round, setRound] = useState<number>(firstLive);
  const activeRound = rounds.includes(round) ? round : firstLive;

  const maxRound = rounds[rounds.length - 1] ?? 1;
  const matches = tournament.matches
    .filter((m) => m.round === activeRound)
    .sort((a, b) => a.position - b.position);

  if (rounds.length === 0) return null;

  return (
    <div className="space-y-3">
      {rounds.length > 1 && (
        <SegmentedControl<string>
          size="sm"
          segments={rounds.map((r) => ({ value: String(r), label: shortRoundLabel(tournament, r, maxRound) }))}
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
}: {
  match: TournamentMatch;
  nameFor: (id: string | null) => string;
  canManage: boolean;
  onOpen: () => void;
}) {
  const bye = (!!match.slot1EntrantId) !== (!!match.slot2EntrantId) && match.status === "complete";
  const bothSet = !!match.slot1EntrantId && !!match.slot2EntrantId;
  const tappable = canManage && (bothSet || match.status === "complete") && !bye;

  const row = (entrantId: string | null, score: number | null) => {
    const isWinner = !!match.winnerEntrantId && entrantId === match.winnerEntrantId;
    const label = entrantId ? nameFor(entrantId) : match.status === "complete" ? "Bye" : "TBD";
    return (
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 ${
          isWinner ? "bg-primary/10" : ""
        }`}
      >
        <span
          className={`truncate text-sm ${
            entrantId ? (isWinner ? "font-semibold" : "") : "text-foreground/40"
          }`}
        >
          {label}
        </span>
        {score != null && <span className="text-sm font-bold tabular-nums">{score}</span>}
      </div>
    );
  };

  const Tag = tappable ? "button" : "div";
  return (
    <Tag
      {...(tappable ? { type: "button" as const, onClick: onOpen } : {})}
      className={`block w-full overflow-hidden rounded-2xl text-left ring-1 ring-border ${
        tappable ? "hover:ring-foreground/25" : ""
      } ${bye ? "opacity-70" : ""}`}
    >
      {row(match.slot1EntrantId, match.slot1Score)}
      <div className="h-px bg-border" />
      {row(match.slot2EntrantId, match.slot2Score)}
      {(match.isPlayIn || match.status === "ready") && (
        <div className="flex items-center justify-between bg-card px-3 py-1">
          {match.isPlayIn ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">Play-in</span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Ready</span>
          )}
          {tappable && match.status !== "complete" && (
            <span className="text-[10px] font-medium text-foreground/40">Tap to score</span>
          )}
        </div>
      )}
    </Tag>
  );
}

/** Short pager label: Play-in / QF / SF / Final / R{n}. */
function shortRoundLabel(t: Tournament, round: number, maxRound: number): string {
  if (t.matches.some((m) => m.round === round && m.isPlayIn)) return "Play-in";
  const fromFinal = maxRound - round;
  if (fromFinal === 0) return "Final";
  if (fromFinal === 1) return "SF";
  if (fromFinal === 2) return "QF";
  return `R${round}`;
}
