// Client helpers for the "Request a Cabin Stay" feature (migration 0032).
// Reads go through the Supabase client (own rows under RLS) + the
// cabin_availability() RPC; writes go through SECURITY DEFINER RPCs
// (request/review/cancel) so capacity + auth live in one place — the same shape
// as the Committees helpers in lib/roles.ts. All functions degrade to safe
// no-ops when there's no backend, so the page still renders a "coming soon".

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { FAMILY_FEST } from "@/lib/data";
import type { Cabin, CabinAvailability, CabinBooking } from "@/lib/types";

/** Add `n` whole days to an ISO date (YYYY-MM-DD), returning ISO. Anchored at
 *  local midnight and sliced back to a date, so it's DST/TZ-safe — same trick
 *  as eventDays() in lib/data.ts. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today as an ISO date (local). */
export function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** Nights occupied by a [checkIn, checkOut) range. */
export function nights(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut + "T00:00:00").getTime() - new Date(checkIn + "T00:00:00").getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** "Jul 27" */
export function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Jul 27 → Aug 1 · 5 nights" */
export function formatStay(checkIn: string, checkOut: string): string {
  const n = nights(checkIn, checkOut);
  return `${shortDate(checkIn)} → ${shortDate(checkOut)} · ${n} night${n === 1 ? "" : "s"}`;
}

/** "All Family Fest Days": arrive the first fest day, depart the day after the
 *  last one (so every fest night is covered). */
export const FF_CHECK_IN = FAMILY_FEST.startDate;
export const FF_CHECK_OUT = addDays(FAMILY_FEST.endDate, 1);

/** Each ISO night of the Family Fest window, for the per-night availability strip. */
export function ffNights(): string[] {
  const out: string[] = [];
  for (let d = FF_CHECK_IN; d < FF_CHECK_OUT; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The two houses, ordered. Empty when there's no backend. */
export async function fetchCabins(): Promise<Cabin[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("cabins")
    .select("id, slug, name, room_count, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as { id: string; slug: string; name: string; room_count: number; sort_order: number }[]).map(
    (c) => ({ id: c.id, slug: c.slug, name: c.name, roomCount: c.room_count, sortOrder: c.sort_order }),
  );
}

/** Rooms still bookable for the whole [checkIn, checkOut) range, per cabin. */
export async function fetchAvailability(checkIn: string, checkOut: string): Promise<CabinAvailability[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data, error } = await sb.rpc("cabin_availability", { p_check_in: checkIn, p_check_out: checkOut });
  if (error) return [];
  return ((data ?? []) as { cabin_id: string; slug: string; name: string; room_count: number; available: number }[]).map(
    (r) => ({ cabinId: r.cabin_id, slug: r.slug, name: r.name, roomCount: r.room_count, available: r.available }),
  );
}

/** Submit a request (always pending). Returns the new id, or an error message. */
export async function requestStay(input: {
  cabinId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  notes?: string | null;
}): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Sign-in isn't available yet." };
  const { data, error } = await sb.rpc("request_cabin_stay", {
    p_cabin: input.cabinId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_guests: input.guests,
    p_notes: input.notes ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** A member's own requests, newest first. Pass `asUserId` to read another
 *  member's requests — used by the admin “View as” preview so it shows that
 *  member's requests, not the real signed-in admin's (an admin can read any
 *  member's rows under RLS). Omit it for the signed-in user. */
export async function fetchMyBookings(asUserId?: string): Promise<CabinBooking[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const uid = asUserId ?? (await sb.auth.getUser()).data.user?.id;
  if (!uid) return [];
  const { data } = await sb
    .from("cabin_bookings")
    .select("id, cabin_id, check_in, check_out, guests, notes, status, review_note, created_at, cabins(name)")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  return (data ?? []).map(mapBookingRow);
}

/** All requests in the given statuses (admin-only — RLS returns nothing for
 *  non-admins). Used by the approval queue + the approved roster. */
export async function fetchBookings(statuses: string[]): Promise<CabinBooking[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("cabin_bookings")
    .select("id, cabin_id, user_id, check_in, check_out, guests, notes, status, review_note, created_at, cabins(name)")
    .in("status", statuses)
    .order("check_in", { ascending: true });
  return (data ?? []).map(mapBookingRow);
}

/** Approve or deny a request (admin-only). Returns an error message on failure
 *  (e.g. the capacity guard tripping). */
export async function reviewStay(id: string, approve: boolean, note?: string | null): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("review_cabin_stay", { p_booking: id, p_approve: approve, p_note: note ?? null });
  return error ? { error: error.message } : {};
}

/** Cancel a request (requester's own, or admin). */
export async function cancelStay(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("cancel_cabin_stay", { p_booking: id });
  return error ? { error: error.message } : {};
}

interface BookingRow {
  id: string;
  cabin_id: string;
  user_id?: string;
  check_in: string;
  check_out: string;
  guests: number;
  notes: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
  // Supabase returns an embedded relation as an object (or array, depending on
  // the FK shape) — handle both defensively.
  cabins?: { name: string } | { name: string }[] | null;
}

function mapBookingRow(r: BookingRow): CabinBooking {
  const cab = Array.isArray(r.cabins) ? r.cabins[0] : r.cabins;
  return {
    id: r.id,
    cabinId: r.cabin_id,
    cabinName: cab?.name,
    userId: r.user_id,
    checkIn: r.check_in,
    checkOut: r.check_out,
    guests: r.guests,
    notes: r.notes,
    status: r.status as CabinBooking["status"],
    reviewNote: r.review_note,
    createdAt: r.created_at,
  };
}
