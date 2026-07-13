// Shared "who's at the resort right now" logic — the same rule "Ask for Help"
// uses to gate itself (lib/helpRequests.ts: eligibleEvents/amIPresent), just
// widened from "am I present" to "who (everyone) is present" so a Home card
// can show the whole crew currently up north, not just answer a yes/no for the
// viewer. Extracted here rather than duplicated so both features stay in sync
// if the presence rule ever changes.
//
// Presence = RSVP'd "going" to an event whose window, widened by
// ±EVENT_PRESENCE_GRACE_DAYS, covers today — day-aware (`days[today]`) on a
// REAL event day for day-RSVP events, lenient ("going at all") on the ±grace
// shoulder — OR an approved cabin booking covering today. See lib/helpRequests.ts
// for the original (single-viewer) version of this rule.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { eligibleEvents, EVENT_PRESENCE_GRACE_DAYS } from "@/lib/helpRequests";
import { effectiveStatus, isOngoing } from "@/lib/events";
import type { EventAttendance, ResortEvent } from "@/lib/types";

export interface PresentMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * From already-loaded events + attendance (e.g. `useEvents()` in lib/hooks.ts),
 * everyone whose RSVP puts them at the resort on `today` (ISO "YYYY-MM-DD").
 * Pure/sync — no network, so it's cheap to recompute on every render.
 */
export function presentFromAttendance(
  events: ResortEvent[],
  rows: EventAttendance[],
  today: string,
  grace: number = EVENT_PRESENCE_GRACE_DAYS,
): PresentMember[] {
  const live = eligibleEvents(events, today, grace);
  if (!live.length) return [];
  const liveById = new Map(live.map((e) => [e.id, e]));
  const seen = new Map<string, PresentMember>();
  for (const r of rows) {
    const ev = liveById.get(r.eventId);
    if (!ev) continue;
    // Day-aware on a REAL event day for day-RSVP events; lenient ("going at
    // all") on the ±grace shoulder, where there's no per-day answer to read.
    const strict = ev.dayRsvp && isOngoing(ev, today);
    const going = strict
      ? r.days && Object.keys(r.days).length
        ? r.days[today] === "going"
        : effectiveStatus(r.status, r.days) === "going"
      : effectiveStatus(r.status, r.days) === "going";
    if (going) seen.set(r.userId, { userId: r.userId, name: r.name, avatarUrl: r.avatarUrl });
  }
  return Array.from(seen.values());
}

interface CabinPresenceRow {
  user_id: string;
  profiles?:
    | { display_name: string | null; avatar_url: string | null }
    | { display_name: string | null; avatar_url: string | null }[]
    | null;
}

/**
 * Members with an APPROVED cabin booking covering `today` (ISO "YYYY-MM-DD").
 * A network read on `cabin_bookings`, which RLS restricts to the viewer's own
 * rows plus (for an admin) everyone's (migration 0032's "own or admin read"
 * policy) — so a non-admin viewer only ever sees their OWN cabin presence
 * here. That's an accepted trade-off (the event-RSVP source above is the
 * resort-wide one, and the RLS denial degrades to just fewer rows, not an
 * error). Empty on any failure / no backend — never throws.
 */
export async function presentFromCabins(today: string): Promise<PresentMember[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb
      .from("cabin_bookings")
      .select("user_id, profiles!cabin_bookings_user_id_fkey(display_name, avatar_url)")
      .eq("status", "approved")
      .lte("check_in", today)
      .gt("check_out", today);
    if (error || !data) return [];
    return (data as unknown as CabinPresenceRow[]).map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return {
        userId: r.user_id,
        name: (p?.display_name && p.display_name.trim()) || "Member",
        avatarUrl: p?.avatar_url ?? null,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Merge two presence lists, de-duped by user id (the first list's name/avatar
 * wins on a tie), sorted by name.
 */
export function mergePresence(a: PresentMember[], b: PresentMember[]): PresentMember[] {
  const out = new Map<string, PresentMember>();
  for (const m of a) out.set(m.userId, m);
  for (const m of b) if (!out.has(m.userId)) out.set(m.userId, m);
  return Array.from(out.values()).sort((x, y) => x.name.localeCompare(y.name));
}
