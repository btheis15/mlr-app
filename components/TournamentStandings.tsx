"use client";

import { computeStandings, hasAnyScores } from "@/lib/tournaments";
import type { Tournament } from "@/lib/tournaments";

/**
 * The standings table for a round-robin (or one pool of a pools tournament).
 * Ranked by the tournament's configured tiebreakers. Point columns (PF/PA/Diff)
 * only show once a score has been recorded — scores are optional, so a
 * winner-only tournament stays a clean W-L(-T) table.
 */
export function TournamentStandings({
  tournament,
  pool = null,
  leaderId = null,
}: {
  tournament: Tournament;
  pool?: string | null;
  /** Highlight the champion/advancing leader, if decided. */
  leaderId?: string | null;
}) {
  const rows = computeStandings(tournament, pool);
  const showPoints = hasAnyScores(tournament);
  const anyTies = rows.some((r) => r.ties > 0);

  if (rows.length === 0) return <p className="text-sm text-foreground/60">No entrants yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-foreground/40">
            <th className="w-6 py-1 text-left font-semibold">#</th>
            <th className="py-1 text-left font-semibold">Team</th>
            <th className="px-1.5 py-1 text-right font-semibold">W</th>
            <th className="px-1.5 py-1 text-right font-semibold">L</th>
            {anyTies && <th className="px-1.5 py-1 text-right font-semibold">T</th>}
            {showPoints && <th className="px-1.5 py-1 text-right font-semibold">PF</th>}
            {showPoints && <th className="px-1.5 py-1 text-right font-semibold">PA</th>}
            {showPoints && <th className="px-1.5 py-1 text-right font-semibold">+/−</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lead = leaderId === r.entrantId;
            return (
              <tr key={r.entrantId} className={`border-t border-border ${lead ? "bg-primary/10" : ""}`}>
                <td className="py-1.5 text-foreground/40">{r.rank}</td>
                <td className="truncate py-1.5 font-medium">
                  {lead && <span className="mr-1">🥇</span>}
                  {r.name}
                </td>
                <td className="px-1.5 py-1.5 text-right font-semibold tabular-nums">{r.wins}</td>
                <td className="px-1.5 py-1.5 text-right tabular-nums text-foreground/60">{r.losses}</td>
                {anyTies && <td className="px-1.5 py-1.5 text-right tabular-nums text-foreground/60">{r.ties}</td>}
                {showPoints && <td className="px-1.5 py-1.5 text-right tabular-nums text-foreground/60">{r.pointsFor}</td>}
                {showPoints && <td className="px-1.5 py-1.5 text-right tabular-nums text-foreground/60">{r.pointsAgainst}</td>}
                {showPoints && (
                  <td className={`px-1.5 py-1.5 text-right tabular-nums ${r.diff > 0 ? "text-primary" : r.diff < 0 ? "text-accent" : "text-foreground/60"}`}>
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
