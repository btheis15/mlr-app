// The list of Family Fest YEARS, and which one the app is currently living in.
//
// `fest_config` has been keyed on `fest_year` (its primary key) since migration
// 0053 — one row per fest — but nothing read it that way: the content layer
// pinned a hardcoded `FEST_YEAR = 2026`, so the app could only ever show one
// fest and a finished one had nowhere to go. This module is the missing piece:
// it reads every config row, names the CURRENT fest (the newest one) and the
// PAST fests (any whose week is over), and by doing so gets the whole
// archive/start-fresh cycle out of code and into data. Adding the 2027 row in
// the Planner is all it takes to slide 2026 into Past Years and point the hub
// at the new season — no deploy, no schema change.
//
// Deliberately derived from DATES, not an `is_archived` flag. A flag would be a
// second source of truth that someone has to remember to flip (and forgetting is
// exactly how the app ended up advertising a finished fest as live); the dates
// are already the season model's input, already editable in the Planner, and
// already correct.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { FAMILY_FEST } from "@/lib/data";
import { WRAP_TAIL_DAYS, toISODate } from "@/lib/festSeason";

/** One fest year — the `fest_config` row, in app-facing shape. */
export interface FestYear {
  year: number;
  name: string;
  tagline: string;
  startDate: string;
  endDate: string;
}

/** The in-code seed year, used when there's no backend / the table is empty —
 *  the same degrade-to-seed contract as the rest of the fest content layer, so
 *  the hub and Past Years never render blank. */
export const SEED_FEST_YEAR: FestYear = {
  year: Number(FAMILY_FEST.startDate.slice(0, 4)),
  name: FAMILY_FEST.name,
  tagline: FAMILY_FEST.tagline,
  startDate: FAMILY_FEST.startDate,
  endDate: FAMILY_FEST.endDate,
};

interface ConfigYearRow {
  fest_year: number;
  name: string;
  tagline: string | null;
  start_date: string;
  end_date: string;
}

/**
 * Every fest year on record, NEWEST FIRST. Falls back to the in-code seed on
 * error / no backend / empty table (never returns an empty array, so callers
 * always have a fest to name).
 */
export async function fetchFestYears(): Promise<FestYear[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [SEED_FEST_YEAR];
  try {
    const { data, error } = await sb
      .from("fest_config")
      .select("fest_year, name, tagline, start_date, end_date")
      .order("fest_year", { ascending: false });
    if (error) return [SEED_FEST_YEAR];
    const rows = (data ?? []) as ConfigYearRow[];
    if (rows.length === 0) return [SEED_FEST_YEAR];
    return rows.map((r) => ({
      year: r.fest_year,
      name: r.name,
      tagline: r.tagline ?? "",
      startDate: r.start_date,
      endDate: r.end_date,
    }));
  } catch {
    return [SEED_FEST_YEAR];
  }
}

/**
 * The fest the app is currently living in: the NEWEST year on record. It stays
 * "current" after its week ends — a concluded fest is still the one the hub
 * talks about (to say thank you) until a newer year is created. `years` must be
 * newest-first, as `fetchFestYears` returns.
 */
export function currentFestYear(years: FestYear[]): FestYear {
  return years[0] ?? SEED_FEST_YEAR;
}

/**
 * Whether a fest year is history — its week ended and the photo-posting tail
 * closed. Same threshold `getFestSeason` uses for the "concluded" phase, so the
 * hub saying "that's a wrap" and this year appearing under Past Years always
 * flip on the same day.
 */
export function isPastFestYear(y: FestYear, today: string = toISODate()): boolean {
  const end = new Date(`${y.endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return false;
  end.setDate(end.getDate() + WRAP_TAIL_DAYS);
  return toISODate(end) < today;
}

/**
 * The Past Years list, newest first. Note this INCLUDES the current year once
 * it's concluded — that's the whole point: the fest that just ended is the
 * first thing someone looks for in the archive, and it shouldn't have to wait
 * for next year's row to be created before it's reachable.
 */
export function pastFestYears(years: FestYear[], today: string = toISODate()): FestYear[] {
  return years.filter((y) => isPastFestYear(y, today));
}
