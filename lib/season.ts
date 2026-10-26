"use client";

import { useEffect, useState } from "react";

export type Season = "winter" | "spring" | "summer" | "fall";

const SEASONS: Season[] = ["winter", "spring", "summer", "fall"];

// Meteorological seasons for the northern hemisphere (the resort is in WI).
export function getSeason(d: Date = new Date()): Season {
  const m = d.getMonth(); // 0 = Jan
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

/**
 * The current season, resolved on the client after mount (null until then, so
 * the static HTML never freezes a build-time season). `?season=winter` (etc.)
 * in the URL overrides it, handy for previewing the other three.
 */
export function useSeason(): Season | null {
  const [season, setSeason] = useState<Season | null>(null);
  useEffect(() => {
    let forced: Season | null = null;
    try {
      const q = new URLSearchParams(window.location.search).get("season");
      if (q && (SEASONS as string[]).includes(q)) forced = q as Season;
    } catch {
      // no URL access — fall through to the date
    }
    setSeason(forced ?? getSeason());
  }, []);
  return season;
}
