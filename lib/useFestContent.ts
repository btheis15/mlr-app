"use client";

// Client hook for the shared Family Fest content (schedule, dinners, payees,
// dues, activities, config). Seeds from the in-code constants so the very first
// paint matches the server render (no hydration shift, identical to the old
// hardcoded behavior), then fetches the live DB content and — optionally — keeps
// it fresh with a Realtime subscription so a Planner edit (web OR iOS) shows up
// without a reload. Mirrors the spirit of useEvents (SWR-style module cache so a
// tab revisit paints instantly instead of blanking out).

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useDebouncedCallback } from "@/lib/hooks";
import { fetchFestContent, SEED_CONTENT, type FestContent } from "@/lib/festContent";

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

// Last-known content, held across remounts so navigating back to a fest page
// paints the live data immediately rather than flashing the seed again.
let cache: FestContent | null = null;

export interface UseFestContent extends FestContent {
  loading: boolean;
  reload: () => Promise<void>;
}

export function useFestContent(opts?: { realtime?: boolean }): UseFestContent {
  const [content, setContent] = useState<FestContent>(cache ?? SEED_CONTENT);
  const [loading, setLoading] = useState(!cache);
  const [scheduleRefetch] = useDebouncedCallback(250);
  const realtime = opts?.realtime ?? false;

  const reload = useCallback(async () => {
    try {
      const c = await fetchFestContent();
      setContent(c);
      cache = c;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
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
