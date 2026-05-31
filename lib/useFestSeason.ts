"use client";

import { useEffect, useState } from "react";
import { getFestSeason, type FestSeason } from "./festSeason";

/**
 * Client hook for the Family Fest season. Returns `null` until mounted so the
 * server render and the first client paint match (no hydration mismatch on the
 * date-sensitive phase); the real value lands right after mount. Re-checks
 * hourly so a long-open tab rolls into — or out of — the live week on its own.
 */
export function useFestSeason(
  startDate: string,
  endDate: string,
): FestSeason | null {
  const [season, setSeason] = useState<FestSeason | null>(null);

  useEffect(() => {
    const update = () => setSeason(getFestSeason(startDate, endDate));
    update();
    const id = setInterval(update, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [startDate, endDate]);

  return season;
}
