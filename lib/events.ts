// Client helpers for the resort events + attendance feature (migrations 0034 +
// 0035). Events are admin-managed in Supabase, merged with the in-code seed
// (Family Fest + the 4th of July) so the calendar shows content even before an
// admin adds anything — and Family Fest stays tied to the season model. Reads go
// through the Supabase client (public-read tables); writes go through SECURITY
// DEFINER RPCs so a member only ever writes their own attendance row and only
// admins can change the calendar. Everything degrades to safe no-ops with no
// backend — the same shape as lib/cabins.ts.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { RESORT_EVENTS } from "@/lib/data";
import type {
  AttendanceStatus,
  AttendanceSummary,
  EventAttendance,
  ResortEvent,
} from "@/lib/types";

/** Each ISO day (YYYY-MM-DD) an event spans, inclusive. Single-day ⇒ [start].
 *  Anchored at local midnight so it's DST/TZ-safe (same trick as cabins.addDays).
 *  This is the generalized form; lib/data.ts keeps a no-arg `eventDays()` bound to
 *  the Family Fest window — they stay separate so data.ts (which we import here)
 *  doesn't have to import back from this module (a cycle). */
export function eventDays(start: string, end?: string | null): string[] {
  const out: string[] = [];
  const last = end || start;
  let d = start;
  // Guard against a bad range (end before start) so we never loop forever.
  for (let i = 0; d <= last && i < 366; i++) {
    out.push(d);
    const nx = new Date(`${d}T00:00:00`);
    nx.setDate(nx.getDate() + 1);
    d = nx.toISOString().slice(0, 10);
  }
  return out;
}

/** True once an event has fully ended (its last day is before today). */
export function isPast(ev: ResortEvent, today: string): boolean {
  return (ev.endDate || ev.startDate) < today;
}

/** True while an event is happening (today within [start, end]). */
export function isOngoing(ev: ResortEvent, today: string): boolean {
  return ev.startDate <= today && today <= (ev.endDate || ev.startDate);
}

/**
 * Roll an attendance row up to a single effective status: "going" if the overall
 * status is going OR any chosen day is going; else "maybe" if anything is maybe;
 * else "not_going". Drives the counts and the overall control (so picking even
 * one Family Fest day reads as Going on the overview).
 */
export function effectiveStatus(
  status: AttendanceStatus,
  days?: Record<string, AttendanceStatus> | null,
): AttendanceStatus {
  const vals = days ? Object.values(days) : [];
  if (status === "going" || vals.includes("going")) return "going";
  if (status === "maybe" || vals.includes("maybe")) return "maybe";
  return "not_going";
}

/** All events (DB ∪ seed), merged by slug (a DB row wins over a seed one), sorted
 *  by start date. Seed-only when there's no backend. */
export async function fetchEvents(): Promise<ResortEvent[]> {
  const sb = supabase;
  let dbEvents: ResortEvent[] = [];
  if (isSupabaseConfigured && sb) {
    try {
      const { data } = await sb
        .from("events")
        .select("id, slug, kind, title, emoji, description, location, start_date, end_date, day_rsvp, source")
        .order("start_date", { ascending: true });
      dbEvents = ((data ?? []) as EventRow[]).map(mapEventRow);
    } catch {
      dbEvents = []; // missing table / bad config ⇒ fall back to the seed
    }
  }
  // Seed events the DB already covers (same slug) drop out — the DB row wins.
  const dbSlugs = new Set(dbEvents.map((e) => e.slug).filter(Boolean));
  const seed = RESORT_EVENTS.filter((e) => !e.slug || !dbSlugs.has(e.slug));
  return [...dbEvents, ...seed].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Upcoming events (ongoing or future), soonest first; optionally capped. */
export function upcomingEvents(events: ResortEvent[], today: string, limit?: number): ResortEvent[] {
  const up = events.filter((e) => !isPast(e, today));
  return typeof limit === "number" ? up.slice(0, limit) : up;
}

/** Events that have ended, most recent first. */
export function pastEvents(events: ResortEvent[], today: string): ResortEvent[] {
  return events
    .filter((e) => isPast(e, today))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/** The single nearest upcoming event, or null. */
export function nextEvent(events: ResortEvent[], today: string): ResortEvent | null {
  return upcomingEvents(events, today, 1)[0] ?? null;
}

/** Every attendance row across all events, with member name + avatar (public
 *  read). Empty with no backend. Group per event with `summarize`. */
export async function fetchAttendance(): Promise<EventAttendance[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data } = await sb
      .from("event_attendance")
      .select("event_id, user_id, status, days, profiles(display_name, avatar_url)");
    return ((data ?? []) as AttendanceRow[]).map(mapAttendanceRow);
  } catch {
    return [];
  }
}

/** The signed-in member's own RSVPs, keyed by event id. Pass `asUserId` for the
 *  admin "view as" preview (an admin can read any member's rows under RLS). */
export async function fetchMyAttendance(asUserId?: string): Promise<Record<string, EventAttendance>> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return {};
  const out: Record<string, EventAttendance> = {};
  try {
    const uid = asUserId ?? (await sb.auth.getUser()).data.user?.id;
    if (!uid) return {};
    const { data } = await sb
      .from("event_attendance")
      .select("event_id, user_id, status, days, profiles(display_name, avatar_url)")
      .eq("user_id", uid);
    for (const r of (data ?? []) as AttendanceRow[]) {
      const a = mapAttendanceRow(r);
      out[a.eventId] = a;
    }
  } catch {
    // No session / bad config ⇒ just no personal RSVPs.
  }
  return out;
}

/** An empty roster — a safe default when an event has no attendance yet. */
export const EMPTY_SUMMARY: AttendanceSummary = {
  going: [],
  maybe: [],
  notGoing: [],
  counts: { going: 0, maybe: 0, notGoing: 0 },
};

/** Group an event's attendance rows into going / maybe / not-going (+ counts),
 *  by effective (day-aware) status, each list ordered by name. */
export function summarize(rows: EventAttendance[]): AttendanceSummary {
  const going: EventAttendance[] = [];
  const maybe: EventAttendance[] = [];
  const notGoing: EventAttendance[] = [];
  for (const r of rows) {
    const s = effectiveStatus(r.status, r.days);
    (s === "going" ? going : s === "maybe" ? maybe : notGoing).push(r);
  }
  const byName = (a: EventAttendance, b: EventAttendance) => a.name.localeCompare(b.name);
  going.sort(byName);
  maybe.sort(byName);
  notGoing.sort(byName);
  return {
    going,
    maybe,
    notGoing,
    counts: { going: going.length, maybe: maybe.length, notGoing: notGoing.length },
  };
}

/** For a multi-day day-RSVP event, the going roster split per ISO day. A member
 *  who's "going" with no per-day map is in for the whole run (counts on every
 *  day); one with a map counts only on the days they marked going. Pass an event's
 *  `summary.going` (already day-aware) so a maybe/can't-make never leaks in. Drives
 *  the per-day breakdown everyone can see and the day toggles when you RSVP. */
export function goingByDay(going: EventAttendance[], days: string[]): Record<string, EventAttendance[]> {
  const out: Record<string, EventAttendance[]> = {};
  for (const day of days) {
    out[day] = going.filter((p) =>
      p.days && Object.keys(p.days).length ? p.days[day] === "going" : true,
    );
  }
  return out;
}

/** The set of days a member is going (for the RSVP day toggles): their explicit
 *  "going" days if they picked any, else every day when they're going overall (the
 *  whole-week default), else none. */
export function myGoingDays(mine: EventAttendance | null, days: string[]): Set<string> {
  if (mine?.days && Object.keys(mine.days).length) {
    return new Set(days.filter((d) => mine.days![d] === "going"));
  }
  return new Set(effectiveStatus(mine?.status ?? "not_going", mine?.days) === "going" ? days : []);
}

/** Set/change my RSVP to an event. `days` is an optional per-day map for day-RSVP
 *  events. Returns an error message on failure. */
export async function setAttendance(
  eventId: string,
  status: AttendanceStatus,
  days?: Record<string, AttendanceStatus> | null,
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Sign-in isn't available yet." };
  const { error } = await sb.rpc("set_event_attendance", {
    p_event: eventId,
    p_status: status,
    p_days: days ?? null,
  });
  return error ? { error: error.message } : {};
}

/** Remove my RSVP to an event. */
export async function clearAttendance(eventId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("clear_event_attendance", { p_event: eventId });
  return error ? { error: error.message } : {};
}

export interface EventInput {
  title: string;
  startDate: string;
  endDate?: string | null;
  kind: ResortEvent["kind"];
  emoji?: string | null;
  location?: string | null;
  description?: string | null;
  dayRsvp: boolean;
}

/** Create an event (admin-only). Returns the new id, or an error message. */
export async function createEvent(input: EventInput): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_event", {
    p_title: input.title,
    p_start_date: input.startDate,
    p_end_date: input.endDate ?? null,
    p_kind: input.kind,
    p_emoji: input.emoji ?? null,
    p_location: input.location ?? null,
    p_description: input.description ?? null,
    p_day_rsvp: input.dayRsvp,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Edit an event (admin-only). */
export async function updateEvent(id: string, input: EventInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("update_event", {
    p_id: id,
    p_title: input.title,
    p_start_date: input.startDate,
    p_end_date: input.endDate ?? null,
    p_kind: input.kind,
    p_emoji: input.emoji ?? null,
    p_location: input.location ?? null,
    p_description: input.description ?? null,
    p_day_rsvp: input.dayRsvp,
  });
  return error ? { error: error.message } : {};
}

/** Delete an event + its attendance (admin-only). */
export async function deleteEvent(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("delete_event", { p_id: id });
  return error ? { error: error.message } : {};
}

/**
 * GOOGLE CALENDAR SEAM (deferred — see CLAUDE.md "Backend seams").
 * The clean path is a PUBLISHED Google Calendar exported as an ICS feed
 * (…/public/basic.ics) set via NEXT_PUBLIC_GOOGLE_CALENDAR_ICS_URL — no OAuth,
 * works on Vercel and static export. To turn it on: fetch + parse the VEVENTs
 * into ResortEvent[] here (source: "gcal", a stable id from each event UID), then
 * merge them in fetchEvents() deduped like the seed. Returns [] today, so nothing
 * depends on it yet.
 */
export async function fetchGcalEvents(): Promise<ResortEvent[]> {
  return [];
}

// ── row mappers ───────────────────────────────────────────────────────────────
interface EventRow {
  id: string;
  slug: string | null;
  kind: string;
  title: string;
  emoji: string | null;
  description: string | null;
  location: string | null;
  start_date: string;
  end_date: string | null;
  day_rsvp: boolean;
  source: string;
}

function mapEventRow(r: EventRow): ResortEvent {
  return {
    id: r.id,
    slug: r.slug ?? undefined,
    kind: (r.kind as ResortEvent["kind"]) ?? "custom",
    title: r.title,
    emoji: r.emoji ?? undefined,
    description: r.description ?? undefined,
    location: r.location ?? undefined,
    startDate: r.start_date,
    endDate: r.end_date,
    dayRsvp: r.day_rsvp,
    source: (r.source as ResortEvent["source"]) ?? "admin",
    persisted: true,
  };
}

interface AttendanceRow {
  event_id: string;
  user_id: string;
  status: string;
  days: Record<string, AttendanceStatus> | null;
  // Supabase returns an embedded relation as an object (or array depending on the
  // FK shape) — handle both defensively, like lib/cabins.ts.
  profiles?:
    | { display_name: string | null; avatar_url: string | null }
    | { display_name: string | null; avatar_url: string | null }[]
    | null;
}

function mapAttendanceRow(r: AttendanceRow): EventAttendance {
  const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    eventId: r.event_id,
    userId: r.user_id,
    name: (p?.display_name && p.display_name.trim()) || "Member",
    avatarUrl: p?.avatar_url ?? null,
    status: r.status as AttendanceStatus,
    days: r.days,
  };
}
