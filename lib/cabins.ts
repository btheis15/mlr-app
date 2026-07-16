// Client helpers for the "Request a Cabin Stay" feature (migration 0032).
// Reads go through the Supabase client (own rows under RLS) + the
// cabin_availability() RPC; writes go through SECURITY DEFINER RPCs
// (request/review/cancel) so capacity + auth live in one place — the same shape
// as the Committees helpers in lib/roles.ts. All functions degrade to safe
// no-ops when there's no backend, so the page still renders a "coming soon".

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { FAMILY_FEST } from "@/lib/data";
import type { Cabin, CabinAvailability, CabinBooking, CabinRoom, CabinRoomAvailability } from "@/lib/types";

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

interface CabinRow {
  id: string;
  slug: string;
  name: string;
  room_count: number;
  bed_count: number | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
}

function mapCabinRow(c: CabinRow): Cabin {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    roomCount: c.room_count,
    bedCount: c.bed_count ?? null,
    notes: c.notes ?? null,
    active: c.active,
    sortOrder: c.sort_order,
  };
}

/** The two houses, ordered. Empty when there's no backend. Only the active ones
 *  — for the admin editor (which also needs to see/reopen a closed cabin), use
 *  fetchCabinsAdmin(). */
export async function fetchCabins(): Promise<Cabin[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("cabins")
    .select("id, slug, name, room_count, bed_count, notes, active, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as CabinRow[]).map(mapCabinRow);
}

/** Every cabin regardless of active state (admin editor only — RLS still lets
 *  anyone read cabins, but there's no reason a member needs the inactive ones). */
export async function fetchCabinsAdmin(): Promise<Cabin[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("cabins")
    .select("id, slug, name, room_count, bed_count, notes, active, sort_order")
    .order("sort_order", { ascending: true });
  return ((data ?? []) as CabinRow[]).map(mapCabinRow);
}

/** Edit a cabin's editable fields (admin-gated by RLS, migration 0089). */
export async function saveCabin(input: {
  id: string;
  name: string;
  roomCount: number;
  bedCount: number | null;
  notes: string | null;
  active: boolean;
}): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb
    .from("cabins")
    .update({
      name: input.name,
      room_count: input.roomCount,
      bed_count: input.bedCount,
      notes: input.notes,
      active: input.active,
    })
    .eq("id", input.id);
  return error ? { error: error.message } : {};
}

interface CabinRoomRow {
  id: string;
  cabin_id: string;
  name: string;
  beds: number;
  description: string | null;
  active: boolean;
  sort_order: number;
}

function mapCabinRoomRow(r: CabinRoomRow): CabinRoom {
  return {
    id: r.id,
    cabinId: r.cabin_id,
    name: r.name,
    beds: r.beds,
    description: r.description ?? null,
    active: r.active,
    sortOrder: r.sort_order,
  };
}

/** The named rooms/areas within a cabin (migration 0092), ordered. Empty for a
 *  cabin that hasn't been broken into rooms — callers should treat that as
 *  "use the plain room-count flow", not as an error. */
export async function fetchCabinRooms(cabinId: string): Promise<CabinRoom[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("cabin_rooms")
    .select("id, cabin_id, name, beds, description, active, sort_order")
    .eq("cabin_id", cabinId)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as CabinRoomRow[]).map(mapCabinRoomRow);
}

/** Create or update a room (admin-gated by RLS, migration 0092). */
export async function saveCabinRoom(input: {
  id?: string;
  cabinId: string;
  name: string;
  beds: number;
  description?: string | null;
  active: boolean;
  sortOrder?: number;
}): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const row = {
    cabin_id: input.cabinId,
    name: input.name,
    beds: input.beds,
    ...(input.description !== undefined ? { description: input.description } : {}),
    active: input.active,
    ...(input.sortOrder != null ? { sort_order: input.sortOrder } : {}),
  };
  const { error } = input.id
    ? await sb.from("cabin_rooms").update(row).eq("id", input.id)
    : await sb.from("cabin_rooms").insert(row);
  return error ? { error: error.message } : {};
}

/** Delete a room (admin-gated by RLS). Any past bookings that reserved it keep
 *  their history — cabin_booking_rooms cascades, so they just lose that link. */
export async function deleteCabinRoom(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("cabin_rooms").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** Per-room state (open/closed, already booked or not) for a date range. */
export async function fetchRoomAvailability(
  cabinId: string,
  checkIn: string,
  checkOut: string,
): Promise<CabinRoomAvailability[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data, error } = await sb.rpc("cabin_room_availability", {
    p_cabin_id: cabinId,
    p_check_in: checkIn,
    p_check_out: checkOut,
  });
  if (error) return [];
  return (
    (data ?? []) as { room_id: string; name: string; beds: number; description: string | null; active: boolean; available: boolean }[]
  ).map((r) => ({
    roomId: r.room_id,
    name: r.name,
    beds: r.beds,
    description: r.description ?? null,
    active: r.active,
    available: r.available,
  }));
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

/** Submit a request (pending, unless auto-approved by the caller afterward).
 *  Pass `forUserId` to book on behalf of another member — admin-only, enforced
 *  server-side; the booking lands under that member's id, with `booked_by`
 *  stamped to the admin who placed it (migration 0087). Pass `roomIds` for a
 *  cabin that's been broken into named rooms (migration 0092) — required in
 *  practice once a cabin has rooms, since that's the whole point of picking
 *  specific ones instead of a bare guest count. Returns the new id, or an
 *  error message. */
export async function requestStay(input: {
  cabinId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  notes?: string | null;
  forUserId?: string | null;
  roomIds?: string[];
}): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Sign-in isn't available yet." };
  const { data, error } = await sb.rpc("request_cabin_stay", {
    p_cabin: input.cabinId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_guests: input.guests,
    p_notes: input.notes ?? null,
    p_for_user: input.forUserId ?? null,
    p_room_ids: input.roomIds?.length ? input.roomIds : null,
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
    .select(
      "id, cabin_id, check_in, check_out, guests, notes, status, review_note, created_at, booked_by, cabins(name), cabin_booking_rooms(room_id, cabin_rooms(name))",
    )
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
    .select(
      "id, cabin_id, user_id, check_in, check_out, guests, notes, status, review_note, created_at, booked_by, cabins(name), cabin_booking_rooms(room_id, cabin_rooms(name))",
    )
    .in("status", statuses)
    .order("check_in", { ascending: true });
  return (data ?? []).map(mapBookingRow);
}

/** Approve or deny a request (admin-only). Pass `notify = false` to skip the
 *  requester's confirmation email (migration 0104) — e.g. booking on behalf of
 *  someone who doesn't use email/the app. Returns an error message on failure
 *  (e.g. the capacity guard tripping). */
export async function reviewStay(
  id: string,
  approve: boolean,
  note?: string | null,
  notify: boolean = true,
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("review_cabin_stay", {
    p_booking: id,
    p_approve: approve,
    p_note: note ?? null,
    p_notify: notify,
  });
  return error ? { error: error.message } : {};
}

/**
 * Cancel a request (requester's own, or admin). `notify` (default true) only
 * has an effect when an admin cancels someone ELSE's booking — the RPC never
 * emails a requester who cancelled their own stay.
 */
export async function cancelStay(id: string, notify = true): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("cancel_cabin_stay", { p_booking: id, p_notify: notify });
  return error ? { error: error.message } : {};
}

/** The specific room(s) an existing booking has attached, if any. */
export async function fetchBookingRooms(bookingId: string): Promise<{ id: string; name: string }[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("cabin_booking_rooms")
    .select("room_id, cabin_rooms(name)")
    .eq("booking_id", bookingId);
  return mapBookingRoomLinks((data ?? []) as BookingRoomLink[]);
}

/** Admin-only: edit a request's dates/guest count/notes (migration 0095) —
 *  for corrections after the fact, e.g. a member asked for 2 beds and only
 *  needs 1. Works on a pending OR approved booking; capacity is still
 *  enforced at review_cabin_stay() time, not here. Pair with setBookingRooms
 *  for reassigning which specific room(s) it reserves. Pass `notify = true`
 *  to email the requester about the change (migration 0105) — off by default,
 *  since most edits are small corrections that don't warrant a new email. */
export async function updateBookingDetails(
  bookingId: string,
  input: { checkIn: string; checkOut: string; guests: number; notes?: string | null },
  notify: boolean = false,
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("admin_update_cabin_booking", {
    p_booking: bookingId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_guests: input.guests,
    p_notes: input.notes ?? null,
    p_notify: notify,
  });
  return error ? { error: error.message } : {};
}

/** Admin-only: (re)assign which room(s) an existing booking reserves — the
 *  ongoing way to fill in/correct rooms on any reservation, including ones
 *  made before rooms existed (migration 0092). Pass an empty array to clear
 *  all room assignments. */
export async function setBookingRooms(bookingId: string, roomIds: string[]): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("set_booking_rooms", { p_booking: bookingId, p_room_ids: roomIds });
  return error ? { error: error.message } : {};
}

interface BookingRoomLink {
  room_id: string;
  cabin_rooms: { name: string } | { name: string }[] | null;
}

function mapBookingRoomLinks(links: BookingRoomLink[]): { id: string; name: string }[] {
  return links.map((l) => {
    const room = Array.isArray(l.cabin_rooms) ? l.cabin_rooms[0] : l.cabin_rooms;
    return { id: l.room_id, name: room?.name ?? "Room" };
  });
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
  booked_by?: string | null;
  // Supabase returns an embedded relation as an object (or array, depending on
  // the FK shape) — handle both defensively.
  cabins?: { name: string } | { name: string }[] | null;
  cabin_booking_rooms?: BookingRoomLink[] | null;
}

function mapBookingRow(r: BookingRow): CabinBooking {
  const cab = Array.isArray(r.cabins) ? r.cabins[0] : r.cabins;
  return {
    id: r.id,
    cabinId: r.cabin_id,
    cabinName: cab?.name,
    userId: r.user_id,
    bookedBy: r.booked_by ?? null,
    rooms: mapBookingRoomLinks(r.cabin_booking_rooms ?? []),
    checkIn: r.check_in,
    checkOut: r.check_out,
    guests: r.guests,
    notes: r.notes,
    status: r.status as CabinBooking["status"],
    reviewNote: r.review_note,
    createdAt: r.created_at,
  };
}
