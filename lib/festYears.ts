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
import type { FestTheme, FestBgStyle, FestBgImageMode, FestFont } from "@/lib/festTheme";

/** One fest year — the `fest_config` row, in app-facing shape. */
export interface FestYear {
  year: number;
  name: string;
  tagline: string;
  startDate: string;
  endDate: string;
  /** This year's theme/title line, e.g. "Ye Olde Family Feste" (0219). "" = none. */
  theme: string;
  /** This year's cover photo. Null ⇒ the app-wide `fest_cover`, then the
   *  bundled art (see FestCover) — so a year without one is never blank. */
  coverUrl: string | null;
  /** This year's palette / background / font overrides (0219). Every field
   *  optional; all-null renders the built-in `.ff-section` parchment look. */
  look: FestTheme;
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
  theme: FAMILY_FEST.theme,
  coverUrl: null,
  look: {},
};

interface ConfigYearRow {
  fest_year: number;
  name: string;
  tagline: string | null;
  start_date: string;
  end_date: string;
  theme?: string | null;
  cover_url?: string | null;
  theme_primary?: string | null;
  theme_accent?: string | null;
  theme_background?: string | null;
  theme_card?: string | null;
  theme_border?: string | null;
  theme_ink?: string | null;
  theme_bg_style?: string | null;
  theme_bg_image_url?: string | null;
  theme_bg_image_mode?: string | null;
  theme_bg_image_opacity?: number | null;
  theme_font?: string | null;
}

/** The columns that existed before migration 0219 — the narrow retry below. */
const BASE_COLUMNS = "fest_year, name, tagline, start_date, end_date";
/** …plus the per-year identity + look added by 0219. */
const LOOK_COLUMNS =
  "theme, cover_url, theme_primary, theme_accent, theme_background, theme_card, theme_border, theme_ink, theme_bg_style, theme_bg_image_url, theme_bg_image_mode, theme_bg_image_opacity, theme_font";

/**
 * Every fest year on record, NEWEST FIRST. Falls back to the in-code seed on
 * error / no backend / empty table (never returns an empty array, so callers
 * always have a fest to name).
 *
 * ⚠️ The 0219 look columns are fetched with a NARROW RETRY, not a bare
 * try/catch. Selecting a column that doesn't exist yet is an error for the whole
 * query, and this function's error path returns the in-code seed — so on a
 * pre-0219 database a single wide select would have quietly replaced the real
 * fest_config rows with the hardcoded 2026 seed everywhere (hub, Planner,
 * archive), which is far worse than losing the theme colours. Same
 * degrade-per-migration contract the rest of the app follows.
 */
export async function fetchFestYears(): Promise<FestYear[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [SEED_FEST_YEAR];
  const read = (columns: string) =>
    sb.from("fest_config").select(columns).order("fest_year", { ascending: false });
  try {
    let { data, error } = await read(`${BASE_COLUMNS}, ${LOOK_COLUMNS}`);
    if (error) ({ data, error } = await read(BASE_COLUMNS));
    if (error) return [SEED_FEST_YEAR];
    const rows = (data ?? []) as unknown as ConfigYearRow[];
    if (rows.length === 0) return [SEED_FEST_YEAR];
    return rows.map(mapYear);
  } catch {
    return [SEED_FEST_YEAR];
  }
}

/** Narrow a free-text DB value to one of a closed set (null otherwise), so a
 *  hand-edited row can't hand an unknown mode to the renderer. */
function oneOf<T extends string>(v: string | null | undefined, allowed: readonly T[]): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

const BG_STYLES = ["default", "flat", "image"] as const satisfies readonly FestBgStyle[];
const BG_MODES = ["cover", "tile"] as const satisfies readonly FestBgImageMode[];
const FONTS = ["cinzel", "playfair", "sans"] as const satisfies readonly FestFont[];

function mapYear(r: ConfigYearRow): FestYear {
  return {
    year: r.fest_year,
    name: r.name,
    tagline: r.tagline ?? "",
    startDate: r.start_date,
    endDate: r.end_date,
    theme: r.theme ?? "",
    coverUrl: r.cover_url?.trim() ? r.cover_url.trim() : null,
    look: {
      primary: r.theme_primary ?? null,
      accent: r.theme_accent ?? null,
      background: r.theme_background ?? null,
      card: r.theme_card ?? null,
      border: r.theme_border ?? null,
      ink: r.theme_ink ?? null,
      bgStyle: oneOf(r.theme_bg_style, BG_STYLES),
      bgImageUrl: r.theme_bg_image_url ?? null,
      bgImageMode: oneOf(r.theme_bg_image_mode, BG_MODES),
      bgImageOpacity: typeof r.theme_bg_image_opacity === "number" ? r.theme_bg_image_opacity : null,
      font: oneOf(r.theme_font, FONTS),
    },
  };
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
