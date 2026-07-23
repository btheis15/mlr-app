"use client";

import { useMemo, useState } from "react";
import { Sheet, SectionLabel } from "@/components/Sheet";
import { useSheetDismiss } from "@/lib/hooks";
import { clearMatchResult } from "@/lib/tournaments";
import type { Tournament, TournamentMatch } from "@/lib/tournaments";

/**
 * Record (or change) a match result. The PRIMARY interaction is one tap: pick
 * the winning entrant and it saves + auto-advances. Scores are OPTIONAL — an
 * "Add scores" expander reveals steppers for anyone who wants them, but a winner
 * alone is a complete result. Reopening a decided match is an override: if a
 * downstream match already has a result, we spell out exactly what will be reset
 * before confirming.
 */
export function MatchResultSheet({
  tournament,
  match,
  nameFor,
  onRecord,
  onClose,
}: {
  tournament: Tournament;
  match: TournamentMatch;
  nameFor: (entrantId: string | null) => string;
  /** Optimistic recordResult from useTournament. Resolves true on success. */
  onRecord: (matchId: string, winnerId: string, s1: number | null, s2: number | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const decided = !!match.winnerEntrantId;
  const [winner, setWinner] = useState<string | null>(match.winnerEntrantId);
  const [showScores, setShowScores] = useState(match.slot1Score != null || match.slot2Score != null);
  const [s1, setS1] = useState<number>(match.slot1Score ?? 0);
  const [s2, setS2] = useState<number>(match.slot2Score ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e1 = match.slot1EntrantId;
  const e2 = match.slot2EntrantId;

  // Downstream matches that currently hold a result derived from this one — they
  // get reset if the winner changes. Walk the next_match chain forward.
  const downstreamToReset = useMemo(() => {
    if (!decided) return [];
    const byId = new Map(tournament.matches.map((m) => [m.id, m]));
    const out: TournamentMatch[] = [];
    let cur = match.nextMatchId ? byId.get(match.nextMatchId) : undefined;
    while (cur && cur.winnerEntrantId) {
      out.push(cur);
      cur = cur.nextMatchId ? byId.get(cur.nextMatchId) : undefined;
    }
    return out;
  }, [decided, match, tournament.matches]);

  const winnerChanged = decided && winner !== match.winnerEntrantId;
  const willReset = winnerChanged && downstreamToReset.length > 0;

  const save = async () => {
    if (!winner) {
      setError("Pick who won.");
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await onRecord(match.id, winner, showScores ? s1 : null, showScores ? s2 : null);
    setBusy(false);
    if (ok) close();
    else setError("Couldn't save — try again.");
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await clearMatchResult(match.id);
    setBusy(false);
    if (err) setError(err);
    else close();
  };

  const roundName = labelForMatch(tournament, match);

  const entrantButton = (entrantId: string | null, score: number, setScore: (n: number) => void) => {
    const picked = winner === entrantId;
    return (
      <div>
        <button
          type="button"
          disabled={!entrantId}
          onClick={() => entrantId && setWinner(entrantId)}
          className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left ring-1 transition ${
            picked
              ? "bg-primary/10 ring-primary"
              : "bg-card ring-border hover:ring-foreground/20"
          }`}
        >
          <span className="font-semibold">{nameFor(entrantId)}</span>
          <span
            className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
              picked ? "bg-primary text-white" : "text-foreground/30 ring-1 ring-border"
            }`}
          >
            {picked ? "✓" : ""}
          </span>
        </button>
        {showScores && (
          <div className="mt-2 flex items-center justify-end gap-3 pr-1">
            <button
              type="button"
              onClick={() => setScore(Math.max(0, score - 1))}
              className="grid h-8 w-8 place-items-center rounded-full bg-card text-lg ring-1 ring-border"
              aria-label="Minus"
            >
              −
            </button>
            <span className="w-8 text-center text-lg font-bold tabular-nums">{score}</span>
            <button
              type="button"
              onClick={() => setScore(score + 1)}
              className="grid h-8 w-8 place-items-center rounded-full bg-card text-lg ring-1 ring-border"
              aria-label="Plus"
            >
              +
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="match-result-title"
      header={
        <div>
          <h2 id="match-result-title" className="text-lg font-bold">
            {decided ? "Change the result" : "Who won?"}
          </h2>
          <p className="text-xs text-foreground/50">{roundName}</p>
        </div>
      }
      footer={
        <div className="space-y-2">
          {error && <p className="text-center text-sm text-accent">{error}</p>}
          {willReset && (
            <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent">
              ⚠️ Changing this will reset {downstreamToReset.length} later{" "}
              {downstreamToReset.length === 1 ? "match" : "matches"} ({downstreamToReset.map((m) => labelForMatch(tournament, m)).join(", ")}
              ) so they can be replayed.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !winner}
            onClick={save}
            className={`w-full rounded-2xl py-3.5 font-semibold text-white disabled:opacity-40 ${
              willReset ? "bg-accent" : "bg-primary"
            }`}
          >
            {willReset ? "Change & reset" : decided ? "Save change" : "Save & advance"}
          </button>
          {decided && (
            <button
              type="button"
              disabled={busy}
              onClick={clear}
              className="w-full rounded-2xl py-2.5 text-sm font-medium text-accent disabled:opacity-40"
            >
              Clear this result
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        <SectionLabel>Tap the winner</SectionLabel>
        {entrantButton(e1, s1, setS1)}
        <p className="text-center text-xs text-foreground/40">vs</p>
        {entrantButton(e2, s2, setS2)}

        <button
          type="button"
          onClick={() => setShowScores((v) => !v)}
          className="mt-1 w-full text-center text-sm font-medium text-primary"
        >
          {showScores ? "Hide scores" : "Add scores (optional)"}
        </button>
      </div>
    </Sheet>
  );
}

/** "Final", "Semifinal", "Play-in", or "Round N · Game M". */
export function labelForMatch(t: Tournament, m: TournamentMatch): string {
  if (m.isPlayIn) return "Play-in";
  const maxRound = t.matches.reduce((n, x) => Math.max(n, x.round), 0);
  const fromFinal = maxRound - m.round; // 0 = final
  if (fromFinal === 0) return "Final";
  if (fromFinal === 1) return "Semifinal";
  if (fromFinal === 2) return "Quarterfinal";
  return `Round ${m.round} · Game ${m.position + 1}`;
}
