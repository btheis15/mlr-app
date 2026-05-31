/**
 * The Family Fest "season" model — the shared spine that lets the resort app
 * (MLR) and the standalone Family Fest app behave as ONE experience that rises
 * and recedes across the year instead of two separate apps. There's no shared
 * backend yet, so this module is mirrored byte-for-byte in both repos (the same
 * way the EVENT / FAMILY_FEST seed data is mirrored) and reads each repo's own
 * event dates.
 *
 * Compute it on the CLIENT (it depends on "now") via `useFestSeason` so the
 * live-week takeover is correct on the static GitHub Pages build as well as on
 * Vercel — a build-time `new Date()` would freeze the phase at deploy time.
 */

export type FestPhase = "before" | "live" | "after";

export interface FestSeason {
  phase: FestPhase;
  /** Convenience: phase === "live" (the event week is happening). */
  isLive: boolean;
  /** Whole days from today until the start (0 once it has started). */
  daysUntilStart: number;
  /** Final run-up — within a week of the start. */
  isSoon: boolean;
  /** 1-based day of the event while live (e.g. 3), else null. */
  dayNumber: number | null;
  /** Total inclusive days in the event window (Sat→Sat = 8). */
  totalDays: number;
}

const MS_PER_DAY = 86_400_000;

/** Midnight-of-the-day timestamp, so comparisons are date-only (not time). */
function dateOnly(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Parse an ISO "YYYY-MM-DD" as LOCAL midnight (avoids a UTC off-by-one). */
function parseDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** ISO "YYYY-MM-DD" for a local date — for matching schedule rows to "today". */
export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getFestSeason(
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): FestSeason {
  const today = dateOnly(now);
  const start = parseDay(startDate);
  const end = parseDay(endDate);

  const daysUntilStart = Math.max(0, Math.round((start - today) / MS_PER_DAY));
  const totalDays = Math.round((end - start) / MS_PER_DAY) + 1;

  let phase: FestPhase;
  if (today < start) phase = "before";
  else if (today <= end) phase = "live";
  else phase = "after";

  const isLive = phase === "live";
  const dayNumber = isLive ? Math.round((today - start) / MS_PER_DAY) + 1 : null;
  const isSoon = phase === "before" && daysUntilStart <= 7;

  return { phase, isLive, daysUntilStart, isSoon, dayNumber, totalDays };
}
