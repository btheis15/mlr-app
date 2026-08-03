// Shared "who's at the resort right now" logic — the same rule "Ask for Help"
// uses to gate itself (lib/helpRequests.ts: eligibleEvents/amIPresent), just
// widened from "am I present" to "who (everyone) is present" so a Home card
// can show the whole crew currently up north, not just answer a yes/no for the
// viewer. Extracted here rather than duplicated so both features stay in sync
// if the presence rule ever changes.
//
// Presence = RSVP'd "going" to an event that is ACTUALLY HAPPENING today —
// started, and not past its end (no early-arrival grace since we can't assume
// arrival time, and no lingering-after grace either: when the event's over,
// this card should clear, not keep showing everyone for a couple more days).
// Day-aware (`days[today]`) on a REAL event day for day-RSVP events — OR an
// approved cabin booking (`presentFromCabins`) OR a house-calendar stay
// (`presentFromHouseStays`) covering today. So the card only appears when
// something concrete puts a person up north right now, and vanishes the moment
// the last such booking/event ends. See lib/helpRequests.ts for the original
// (single-viewer) Ask-for-Help version, which DOES grace both sides (arriving
// early to help set up / lingering after is reasonable there); this card is
// stricter on purpose. `grace` defaults to 0 here for that reason — a caller
// can still widen it, but WhosUpNorth wants the tight window.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { eligibleEvents } from "@/lib/helpRequests";
import { addDays } from "@/lib/cabins";
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
  grace: number = 0,
): PresentMember[] {
  // graceBefore=0: an event that hasn't started yet is never "live" for this
  // card, no matter how close. graceAfter=`grace` (0 by default): once the
  // event ends the card clears — see the module note above.
  const live = eligibleEvents(events, today, 0, grace);
  if (!live.length) return [];
  const liveById = new Map(live.map((e) => [e.id, e]));
  const seen = new Map<string, PresentMember>();
  for (const r of rows) {
    const ev = liveById.get(r.eventId);
    if (!ev) continue;
    // Day-aware on a REAL event day for day-RSVP events. On the lingering-
    // after shoulder (event has ended, within `grace` days), a naive "going at
    // all" check would show someone who only RSVP'd for, say, Sun–Tue as still
    // up north through the following Friday — because the EVENT's own window
    // (widened by grace) extends that far, even though THIS PERSON left after
    // Tuesday. So on that shoulder we widen grace around the person's OWN last
    // "going" day instead of the event's full run.
    const strict = ev.dayRsvp && isOngoing(ev, today);
    let going: boolean;
    if (strict) {
      going = r.days && Object.keys(r.days).length ? r.days[today] === "going" : effectiveStatus(r.status, r.days) === "going";
    } else if (ev.dayRsvp && r.days && Object.keys(r.days).length) {
      const goingDays = Object.keys(r.days)
        .filter((d) => r.days![d] === "going")
        .sort();
      going = goingDays.length
        ? goingDays[0] <= today && today <= addDays(goingDays[goingDays.length - 1], grace)
        : false;
    } else {
      going = effectiveStatus(r.status, r.days) === "going";
    }
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

interface HouseStayPresenceRow {
  created_by: string;
  profiles?:
    | { display_name: string | null; avatar_url: string | null }
    | { display_name: string | null; avatar_url: string | null }[]
    | null;
}

/**
 * Members with a house-calendar stay (`house_stays`, migration 0071) covering
 * `today` (ISO "YYYY-MM-DD"). `end_date` is INCLUSIVE (a one-night stay has
 * end = start), so today is covered when `start_date <= today <= end_date`.
 * Like `presentFromCabins`, RLS scopes this to what the viewer can see — a
 * house's stays are readable only to that house's members (`is_house_member`,
 * migration 0065/0071) — so a viewer sees their own house's crew, and a
 * non-member simply gets fewer rows, never an error. Only the booking member
 * (`created_by`) is surfaced; free-text `guest_names` have no account/profile
 * to show. Empty on any failure / no backend — never throws.
 */
export async function presentFromHouseStays(today: string): Promise<PresentMember[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb
      .from("house_stays")
      .select("created_by, profiles:created_by(display_name, avatar_url)")
      .lte("start_date", today)
      .gte("end_date", today);
    if (error || !data) return [];
    return (data as unknown as HouseStayPresenceRow[]).map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return {
        userId: r.created_by,
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
