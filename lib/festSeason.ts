/**
 * The Family Fest "season" model — the shared spine that lets the resort app
 * (MLR) and the standalone Family Fest app behave as ONE experience that rises
 * and recedes across the year instead of two separate apps. There's no shared
 * backend yet, so this module is mirrored byte-for-byte in both repos (the same
 * way the EVENT / FAMILY_FEST seed data is mirrored) and reads each repo's own
 * event dates.
 *
 * Compute it on the CLIENT (it depends on "now") via `useFestSeason` — a
 * build-time `new Date()` would freeze the phase at deploy time.
 */

/**
 * The five phases a fest year moves through. Note that "off-season" and
 * "concluded" are BOTH quiet, but they are not the same thing and must not be
 * collapsed back together: "off-season" means the fest window is still ahead
 * (too far out to start the planning takeover), while "concluded" means the
 * window is behind us and the photo-posting tail has closed. They used to share
 * one phase, and the result was the hub rendering a countdown to a date in the
 * past — which `Countdown` clamps to zero and reads as "🎉 Family Fest is on —
 * welcome Up North!", so a finished fest advertised itself as live indefinitely.
 * Splitting them lets a finished year say so (and slide into Past Years) while
 * a year with future dates still gets its countdown.
 */
export type FestPhase = "off-season" | "planning" | "live" | "wrap" | "concluded";

/** How early the partial "planning" takeover begins (rally volunteers + show
 *  what's being planned), in days before the start. */
export const PLANNING_LEAD_DAYS = 60;
/** How long the full takeover lingers after the event ends (so people can keep
 *  posting photos they didn't get to during the week), in days after the end. */
export const WRAP_TAIL_DAYS = 14;

export interface FestSeason {
  phase: FestPhase;
  /** Convenience: phase === "live" (the event week is happening). */
  isLive: boolean;
  /** phase === "planning" — partial takeover in the 60-day run-up. */
  isPlanning: boolean;
  /** phase === "wrap" — full takeover lingers for 2 weeks after, to post photos. */
  isWrap: boolean;
  /** phase === "concluded" — this year's fest is history. The hub says thank
   *  you and the week itself moves to Past Years (/family-fest/past). */
  isConcluded: boolean;
  /** Any non-quiet phase (planning | live | wrap) — the fest is prominent. */
  isTakeover: boolean;
  /** Whole days from today until the start (0 once it has started). */
  daysUntilStart: number;
  /** Final run-up — within a week of the start (subset of "planning"). */
  isSoon: boolean;
  /** 1-based day of the event while live (e.g. 3), else null. */
  dayNumber: number | null;
  /** Total inclusive days in the event window (e.g. Mon→Fri = 5). */
  totalDays: number;
  /** Whole days since the event ended (0 before/at the end). */
  daysSinceEnd: number;
  /** Days the photo-posting window stays open during "wrap" (0 otherwise). */
  wrapDaysLeft: number;
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

  const daysToStart = Math.round((start - today) / MS_PER_DAY);
  const daysAfterEnd = Math.round((today - end) / MS_PER_DAY);
  const totalDays = Math.round((end - start) / MS_PER_DAY) + 1;

  let phase: FestPhase;
  // Empty/malformed dates parse to NaN, and every comparison against NaN is
  // false — which would fall through to the final `else` and report a fest that
  // has no dates at all as "concluded". Callers that render before their dates
  // resolve (FestRsvp passes "" until its event loads) documented this as
  // degrading to the quiet, claim-nothing "off-season", so keep that contract
  // explicit now that the else-branch means something specific.
  if (Number.isNaN(start) || Number.isNaN(end)) {
    phase = "off-season";
  } else if (today < start) {
    phase = daysToStart <= PLANNING_LEAD_DAYS ? "planning" : "off-season";
  } else if (today <= end) {
    phase = "live";
  } else {
    phase = daysAfterEnd <= WRAP_TAIL_DAYS ? "wrap" : "concluded";
  }

  const isLive = phase === "live";
  const isPlanning = phase === "planning";
  const isWrap = phase === "wrap";
  const isConcluded = phase === "concluded";
  const dayNumber = isLive ? Math.round((today - start) / MS_PER_DAY) + 1 : null;
  const daysUntilStart = Math.max(0, daysToStart);
  const daysSinceEnd = Math.max(0, daysAfterEnd);

  return {
    phase,
    isLive,
    isPlanning,
    isWrap,
    isConcluded,
    // Spelled out as the three loud phases rather than `phase !== "off-season"`:
    // now that "concluded" is its own phase, the old negation would have started
    // counting a finished fest as a takeover (hiding it from Upcoming Events,
    // etc.). A concluded fest is quiet, exactly like the off-season.
    isTakeover: isPlanning || isLive || isWrap,
    daysUntilStart,
    isSoon: isPlanning && daysUntilStart <= 7,
    dayNumber,
    totalDays,
    daysSinceEnd,
    wrapDaysLeft: isWrap ? Math.max(0, WRAP_TAIL_DAYS - daysAfterEnd) : 0,
  };
}
