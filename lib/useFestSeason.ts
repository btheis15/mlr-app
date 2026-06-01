"use client";

import { getFestSeason, type FestSeason } from "./festSeason";
import { useDemoDate } from "./DemoDateProvider";

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
