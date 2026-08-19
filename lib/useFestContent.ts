"use client";

// Client hook for the shared Family Fest content (schedule, dinners, payees,
// dues, activities, config). Seeds from the in-code constants so the very first
// paint matches the server render (no hydration shift, identical to the old
// hardcoded behavior), then the shared SWR cache (lib/swrCache) takes over:
// last-known live content is held in memory across remounts AND persisted
// on-device, so a tab revisit — or a cold app open — paints the real data
// instantly instead of flashing the seed, while a background fetch (and,
// optionally, a Realtime subscription) keeps it current.

import { useEffect } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useDebouncedCallback } from "@/lib/hooks";
import { useCachedResource } from "@/lib/swrCache";
import {
  fetchFestContent,
  fetchFestContentForYear,
  SEED_CONTENT,
  type FestContent,
} from "@/lib/festContent";
import { fetchFestYears, SEED_FEST_YEAR, type FestYear } from "@/lib/festYears";

/** Seed for `useFestYears` — a stable module constant, NOT a fresh array per
 *  render, since `useCachedResource` holds it in a ref and compares identity. */
const SEED_YEARS: FestYear[] = [SEED_FEST_YEAR];

const FEST_TABLES = [
  "fest_config",
  "fest_dues",
  "fest_schedule_items",
  "fest_dinners",
  "fest_payees",
  "fest_activities",
] as const;

// home_callouts (migration 0083) subscribes on its OWN channel, not appended to
// FEST_TABLES: a postgres_changes binding to a table that doesn't exist yet
// fails that channel's join, which would silently kill realtime for every fest
// table sharing it on a pre-0083 database. Isolated, the worst case is just "no
// live call-out updates until the migration runs" — reads still work (the fetch
// falls back to the in-code seed).
const CALLOUT_TABLE = "home_callouts";

export interface UseFestContent extends FestContent {
  loading: boolean;
  reload: () => Promise<void>;
}

export function useFestContent(opts?: { realtime?: boolean }): UseFestContent {
  // Public content, unscoped key. `empty` is the in-code seed, so the first
  // paint (and the prerendered HTML) is the old hardcoded render; the
  // persisted snapshot then swaps in the last-known live content one tick
  // after mount, and the always-on revalidate brings it fully current.
  const { data: content, loading, reload } = useCachedResource<FestContent>(
    "festContent",
    SEED_CONTENT,
    fetchFestContent,
    { persist: "local" },
  );
  const [scheduleRefetch] = useDebouncedCallback(250);
  const realtime = opts?.realtime ?? false;

  useEffect(() => {
    const sb = supabase;
    if (!realtime || !isSupabaseConfigured || !sb) return;
    const channel = sb.channel("fest-content-live");
    for (const table of FEST_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () =>
        scheduleRefetch(reload),
      );
    }
    channel.subscribe();
    const calloutChannel = sb
      .channel("home-callouts-live")
      .on("postgres_changes", { event: "*", schema: "public", table: CALLOUT_TABLE }, () =>
        scheduleRefetch(reload),
      );
    calloutChannel.subscribe();
    return () => {
      sb.removeChannel(channel);
      sb.removeChannel(calloutChannel);
    };
  }, [reload, realtime, scheduleRefetch]);

  return { ...content, loading, reload };
}

/**
 * One PAST year's content, for the Past Years archive
 * (/family-fest/past/[year]). Deliberately NOT the same hook as
 * `useFestContent`:
 *
 *  - It's keyed per year (`festContent.<year>`), so browsing 2026's archive
 *    can't overwrite the current fest's cached bundle — or be overwritten by it.
 *  - Its empty value is `null`, not the seed. The hub must never render blank,
 *    but an archive must never render CONTENT IT DOESN'T HAVE: seeding a past
 *    year with the in-code 2026 schedule would fabricate history. `null` means
 *    "nothing loaded yet or no such year", which the page reports honestly.
 *  - No Realtime. A finished fest doesn't change; the persisted snapshot means
 *    a revisit paints instantly and offline.
 */
export function useFestYearContent(year: number | null): {
  content: FestContent | null;
  loading: boolean;
} {
  const { data, loading } = useCachedResource<FestContent | null>(
    year == null ? null : `festContent.${year}`,
    null,
    () => (year == null ? Promise.resolve(null) : fetchFestContentForYear(year)),
    { persist: "local" },
  );
  return { content: data, loading };
}

/**
 * Every fest year on record (newest first) — what the Past Years index lists
 * and what the sub-nav uses to decide whether there's an archive to link to.
 * Seeded with the in-code year so the first paint matches the server render.
 */
export function useFestYears(): { years: FestYear[]; loading: boolean } {
  const { data, loading } = useCachedResource<FestYear[]>(
    "festYears",
    SEED_YEARS,
    fetchFestYears,
    { persist: "local" },
  );
  return { years: data, loading };
}
