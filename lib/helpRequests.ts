// Client helpers for "Ask for Help" (BETA, migration 0037). A member who's at
// the resort posts a short request; willing members who are ALSO at the resort
// get notified. Reads go through the Supabase client (members-read tables);
// writes go through SECURITY DEFINER RPCs (request/respond/resolve). Everything
// degrades to safe no-ops with no backend — same shape as lib/cabins.ts /
// lib/events.ts.
//
// PRESENCE ("at the resort right now") is derived here from data we already
// have — no geolocation. You're present if you're RSVP'd "going" to an event
// whose window, widened by ±EVENT_PRESENCE_GRACE_DAYS for early arrivals /
// lingering long weekends, includes today; or you have an approved cabin stay
// covering today. The client computes the "live event" snapshot (it merges DB +
// in-code seed events — Family Fest's dates live in code, not the DB) and hands
// it to request_help(); the server resolves recipients from it (so a client can
// never target arbitrary members). See migration 0037.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { addDays } from "@/lib/cabins";
import { effectiveStatus, isOngoing } from "@/lib/events";
import type {
  EventAttendance,
  HelpRequest,
  HelpRequestStatus,
  HelpResponse,
  ResortEvent,
} from "@/lib/types";

/** How many days BEFORE/AFTER an event still count as "at the resort" — people
 *  arrive early and linger after a long weekend. Tune in one place. */
export const EVENT_PRESENCE_GRACE_DAYS = 2;

/** The kind of help a request is — drives the icon + how the push reads. Most
 *  asks are everyday tasks (moving, setup, a hand with something); "Urgent" is
 *  the rare emergency. Stored as the `key` in help_requests.category; the migration
 *  maps the same keys to a leading glyph in the push title. */
export const HELP_TYPES = [
  { key: "hand", emoji: "🙌", label: "Lend a hand" },
  { key: "move", emoji: "🪵", label: "Move / haul" },
  { key: "setup", emoji: "🔧", label: "Set up / project" },
  { key: "ride", emoji: "🚗", label: "Ride" },
  { key: "supplies", emoji: "🛒", label: "Supplies" },
  { key: "urgent", emoji: "🚨", label: "Urgent" },
] as const;

export type HelpTypeKey = (typeof HELP_TYPES)[number]["key"];

/** The default request type — a friendly "lend a hand", never urgent. */
export const DEFAULT_HELP_TYPE: HelpTypeKey = "hand";

/** Look up a type by its stored key (null/unknown → null). */
export function helpType(key: string | null) {
  return HELP_TYPES.find((t) => t.key === key) ?? null;
}

/** Events whose ±grace window includes `today` (so the 4th-of-July Fri–Sun event
 *  is "live" Wed–Tue). The basis for who can ask for / receive help today. */
export function eligibleEvents(
  events: ResortEvent[],
  today: string,
  grace = EVENT_PRESENCE_GRACE_DAYS,
): ResortEvent[] {
  return events.filter((e) => {
    const from = addDays(e.startDate, -grace);
    const to = addDays(e.endDate || e.startDate, grace);
    return from <= today && today <= to;
  });
}

/** The targeting snapshot passed to request_help: all live event ids, plus the
 *  `strict` subset (day-RSVP events on a REAL event day) where the recipient
 *  must be going *today* specifically — so a Mon–Wed Family Fest attendee isn't
 *  pinged on Thursday. On the ±grace shoulder days the event is "eligible" but
 *  not "strict" (we can't read a per-day answer for a day outside the run). */
export function helpTargeting(
  events: ResortEvent[],
  today: string,
  grace = EVENT_PRESENCE_GRACE_DAYS,
): { eligible: string[]; strict: string[] } {
  const live = eligibleEvents(events, today, grace);
  return {
    eligible: live.map((e) => e.id),
    strict: live.filter((e) => e.dayRsvp && isOngoing(e, today)).map((e) => e.id),
  };
}

/** Whether the viewer themselves is "at the resort" (so the Ask button is live).
 *  Mirrors the server's requester gate: effective-going to any eligible event,
 *  or an approved stay covering today. */
export function amIPresent(
  mine: Record<string, EventAttendance>,
  events: ResortEvent[],
  today: string,
  bookingCoversToday: boolean,
): boolean {
  if (bookingCoversToday) return true;
  return eligibleEvents(events, today).some((e) => {
    const a = mine[e.id];
    return a ? effectiveStatus(a.status, a.days) === "going" : false;
  });
}

/** Google Maps deep link for a shared pin (opens Maps on iOS/Android, web else). */
export function mapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

// ── Writes (SECURITY DEFINER RPCs) ───────────────────────────────────────────

/** Post a help request. Returns the new id + how many willing/present members it
 *  reached, or an error message (e.g. the "you must be at the resort" gate). */
export async function requestHelp(input: {
  description: string;
  category?: string | null;
  whereText?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** ISO timestamp; defaults to now server-side. */
  neededAt?: string | null;
  /** How many people you need (≥1). */
  neededCount?: number;
  audience?: "present" | "all_willing";
  eligible: string[];
  strict: string[];
  /** Resort-local ISO date (YYYY-MM-DD) for day-aware matching. */
  today: string;
}): Promise<{ id?: string; notified?: number; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Sign-in isn't available yet." };
  const { data, error } = await sb.rpc("request_help", {
    p_description: input.description,
    p_category: input.category ?? null,
    p_where_text: input.whereText ?? null,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_needed_at: input.neededAt ?? null,
    p_needed_count: input.neededCount ?? 1,
    p_audience: input.audience ?? "present",
    p_eligible: input.eligible,
    p_strict: input.strict,
    p_today: input.today,
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; notified: number } | null;
  return { id: row?.id, notified: row?.notified ?? 0 };
}

/** Say "on my way" to an open request (the only response). Idempotent. */
export async function respondToHelp(requestId: string, note?: string | null): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("respond_to_help", { p_request: requestId, p_note: note ?? null });
  return error ? { error: error.message } : {};
}

/** Withdraw your "on my way" (plans changed). */
export async function withdrawHelp(requestId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("withdraw_help", { p_request: requestId });
  return error ? { error: error.message } : {};
}

/** Resolve / cancel / reopen a request (requester or admin). */
export async function setHelpStatus(id: string, status: HelpRequestStatus): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("set_help_status", { p_request: id, p_status: status });
  return error ? { error: error.message } : {};
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** All help requests (members-read), newest first, with requester + responders
 *  joined. Empty with no backend. */
export async function fetchHelpRequests(): Promise<HelpRequest[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data } = await sb
      .from("help_requests")
      .select(
        "id, user_id, description, category, where_text, lat, lng, needed_at, needed_count, status, fulfilled_at, notified_count, created_at, expires_at, " +
          "requester:profiles!help_requests_user_id_fkey(display_name, avatar_url), " +
          "help_responses(user_id, note, created_at, responder:profiles!help_responses_user_id_fkey(display_name, avatar_url))",
      )
      .order("created_at", { ascending: false });
    return ((data ?? []) as unknown as HelpRequestRow[]).map(mapHelpRequestRow);
  } catch {
    return [];
  }
}

// ── row mappers ───────────────────────────────────────────────────────────────
type ProfileEmbed =
  | { display_name: string | null; avatar_url: string | null }
  | { display_name: string | null; avatar_url: string | null }[]
  | null;

interface HelpResponseRow {
  user_id: string;
  note: string | null;
  created_at: string;
  responder?: ProfileEmbed;
}

interface HelpRequestRow {
  id: string;
  user_id: string;
  description: string;
  category: string | null;
  where_text: string | null;
  lat: number | null;
  lng: number | null;
  needed_at: string;
  needed_count: number;
  status: string;
  fulfilled_at: string | null;
  notified_count: number;
  created_at: string;
  expires_at: string | null;
  requester?: ProfileEmbed;
  help_responses?: HelpResponseRow[] | null;
}

function nameOf(p: ProfileEmbed | undefined): { name: string; avatarUrl: string | null } {
  const row = Array.isArray(p) ? p[0] : p;
  return {
    name: (row?.display_name && row.display_name.trim()) || "Member",
    avatarUrl: row?.avatar_url ?? null,
  };
}

function mapHelpResponseRow(r: HelpResponseRow): HelpResponse {
  const who = nameOf(r.responder);
  return {
    userId: r.user_id,
    name: who.name,
    avatarUrl: who.avatarUrl,
    note: r.note,
    createdAt: r.created_at,
  };
}

function mapHelpRequestRow(r: HelpRequestRow): HelpRequest {
  const who = nameOf(r.requester);
  return {
    id: r.id,
    userId: r.user_id,
    name: who.name,
    avatarUrl: who.avatarUrl,
    description: r.description,
    category: r.category,
    whereText: r.where_text,
    lat: r.lat,
    lng: r.lng,
    neededAt: r.needed_at,
    neededCount: r.needed_count ?? 1,
    status: r.status as HelpRequestStatus,
    fulfilledAt: r.fulfilled_at,
    notifiedCount: r.notified_count,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    responses: (r.help_responses ?? [])
      .map(mapHelpResponseRow)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
