"use client";

// Client hook for the shared Family Fest content (schedule, dinners, payees,
// dues, activities, config). Seeds from the in-code constants so the very first
// paint matches the server render (no hydration shift, identical to the old
// hardcoded behavior), then the shared SWR cache (lib/swrCache) takes over:
// last-known live content is held in memory across remounts AND persisted
// on-device, so a tab revisit — or a cold app open — paints the real data
// instantly instead of flashing the seed, while a background fetch (and,
// optionally, a Realtime subscription) keeps it current.

import { useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useDebouncedCallback } from "@/lib/hooks";
import { useCachedResource } from "@/lib/swrCache";
import { fetchFestContent, SEED_CONTENT, type FestContent } from "@/lib/festContent";

// Per-mount channel-name suffix. useFestContent({realtime:true}) is called from
// 8+ surfaces, several of which can be mounted at once (Home + a fest page).
// Static topic names ("fest-content-live") mean those mounts all subscribe to
// the SAME supabase-js channel object, so redundant bindings pile up and one
// unmount's removeChannel tears down a topic another mount still needs. A unique
// suffix gives each mount its own channel that it alone owns and cleans up.
let festChannelSeq = 0;

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
  const instanceRef = useRef<number | null>(null);
  if (instanceRef.current === null) instanceRef.current = ++festChannelSeq;

  useEffect(() => {
    const sb = supabase;
    if (!realtime || !isSupabaseConfigured || !sb) return;
    const suffix = instanceRef.current;
    const channel = sb.channel(`fest-content-live-${suffix}`);
    for (const table of FEST_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () =>
        scheduleRefetch(reload),
      );
    }
    channel.subscribe();
    const calloutChannel = sb
      .channel(`home-callouts-live-${suffix}`)
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
