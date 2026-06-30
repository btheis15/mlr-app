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
    return () => {
      sb.removeChannel(channel);
    };
  }, [reload, realtime, scheduleRefetch]);

  return { ...content, loading, reload };
}
