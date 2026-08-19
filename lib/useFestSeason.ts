"use client";

import { getFestSeason, type FestSeason } from "./festSeason";
import { useDemoDate } from "./DemoDateProvider";
import { useFestContent } from "./useFestContent";

/**
 * Client hook for the Family Fest season. Reads the effective "now" from the
 * DemoDateProvider (the real date, or a simulated one set in Profile), so the
 * season is correct on the static Pages build and Vercel, and respects the
 * "see as if it's this day" demo override. Returns `null` until mounted so the
 * server render and first client paint match (no hydration mismatch).
 */
export function useFestSeason(
  startDate: string,
  endDate: string,
): FestSeason | null {
  const { now } = useDemoDate();
  if (!now) return null;
  return getFestSeason(startDate, endDate, now);
}

/**
 * The CURRENT fest's season, resolved from the database rather than the in-code
 * seed — for the surfaces outside the `/family-fest` section that key off "is
 * the fest happening" (the tab bar's live dot, Home's cards, the dues call-out).
 *
 * Those all used to read `FAMILY_FEST.startDate`/`.endDate` from lib/data.ts.
 * That was survivable while the fest dates could only change by editing code,
 * but a new fest year can now be created in-app (see `startFestYear`) — so a
 * seed-based season would have the whole app still counting down to the fest
 * that just finished while the hub planned the next one. Reading the live config
 * is what keeps one answer to "which fest, and where are we in it".
 *
 * Rides the shared `festContent` SWR cache, so this is a deduped read of data
 * Home already loads — not an extra fetch per consumer.
 */
export function useCurrentFestSeason(): FestSeason | null {
  const { config } = useFestContent();
  return useFestSeason(config.startDate, config.endDate);
}
