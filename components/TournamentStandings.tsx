"use client";

import { computeStandings, hasAnyScores, standingTieNotes, tiebreakerLegend } from "@/lib/tournaments";
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
  const tieNotes = standingTieNotes(tournament, pool);
  const legend = tiebreakerLegend(tournament, showPoints);

  if (rows.length === 0) return <p className="text-sm text-foreground/60">No entrants yet.</p>;

  // Fixed, right-aligned stat columns so W/L(/T/PF/PA/±) line up in tidy columns
  // and the name column takes the slack (instead of the numbers drifting apart).
  const stat = "w-9 px-0 py-1.5 text-right tabular-nums";
  const statHead = "w-9 px-0 py-1 text-right font-semibold";

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-foreground/40">
            <th className="w-6 py-1 text-left font-semibold">#</th>
            <th className="py-1 pr-2 text-left font-semibold">Team</th>
            <th className={statHead}>W</th>
            <th className={statHead}>L</th>
            {anyTies && <th className={statHead}>T</th>}
            {showPoints && <th className={statHead}>PF</th>}
            {showPoints && <th className={statHead}>PA</th>}
            {showPoints && <th className={statHead}>+/−</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lead = leaderId === r.entrantId;
            return (
              <tr key={r.entrantId} className={`border-t border-border ${lead ? "bg-primary/10" : ""}`}>
                <td className="py-1.5 text-foreground/40">{r.rank}</td>
                <td className="truncate py-1.5 pr-2 font-medium">
                  {lead && <span className="mr-1">🥇</span>}
                  {r.name}
                </td>
                <td className={`${stat} font-semibold`}>{r.wins}</td>
                <td className={`${stat} text-foreground/60`}>{r.losses}</td>
                {anyTies && <td className={`${stat} text-foreground/60`}>{r.ties}</td>}
                {showPoints && <td className={`${stat} text-foreground/60`}>{r.pointsFor}</td>}
                {showPoints && <td className={`${stat} text-foreground/60`}>{r.pointsAgainst}</td>}
                {showPoints && (
                  <td className={`${stat} ${r.diff > 0 ? "text-primary" : r.diff < 0 ? "text-accent" : "text-foreground/60"}`}>
                    {r.diff > 0 ? `+${r.diff}` : r.diff}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {(tieNotes.length > 0 || (legend && rows.length > 1)) && (
        <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] leading-relaxed text-foreground/55">
          {tieNotes.map((n, i) => (
            <p key={i}>
              <span className="font-medium text-foreground/75">{n.over}</span> ranks above {n.under} — {n.reason}.
            </p>
          ))}
          {legend && rows.length > 1 && <p>Ties are broken by {legend}.</p>}
        </div>
      )}
    </div>
  );
}
