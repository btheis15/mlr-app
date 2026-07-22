// Sign-up time slots for a schedule event. Two modes (migration 0135 → 0136):
//
//  • "interval" — the slot list is DERIVED here from the event's own signup*
//    config (capacity / interval / first / last), the same values
//    sign_up_for_schedule_slot() re-derives server-side, so the two never
//    disagree. All slots share the event's single day and one length.
//  • "slots" — the creator lists arbitrary, independent slots (their own day +
//    time, no shared increment) as rows in `fest_schedule_slots`.
//
// A sign-up is one person per row: a linked member OR a typed name, plus a
// value for each admin-defined custom column (event.signupFields). Any
// signed-in member can add anyone, and add several.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ScheduleEvent, ScheduleSlot } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/format";

export interface ScheduleSignup {
  id: string;
  /** "HH:MM" for interval mode; null for an explicit slot. */
  slotStart: string | null;
  /** The explicit-slot id (slots mode); null for interval mode. */
  slotId: string | null;
  userId: string | null;
  name: string;
  addedBy: string | null;
  /** Custom-column values, keyed by field id (event.signupFields). */
  fields: Record<string, string>;
}

interface ScheduleSignupRow {
  id: string;
  slot_start: string | null;
  slot_id: string | null;
  user_id: string | null;
  name: string;
  added_by: string | null;
  fields: Record<string, string> | null;
}

interface ScheduleSlotRow {
  id: string;
  schedule_item_id: string;
  day: string | null;
  start_time: string;
  end_time: string | null;
  label: string | null;
  capacity: number | null;
  position: number;
}

/** The event's config needed to compute an interval-mode slot list. */
export type SignupConfig = Pick<
  ScheduleEvent,
  "signupEnabled" | "signupCapacity" | "signupSlotMinutes" | "signupStartTime" | "signupEndTime"
>;

/** "HH:MM" start times from signupStartTime up to (not reaching) signupEndTime,
 *  signupSlotMinutes apart. Mirrors fest_schedule_slot_starts() in Postgres. */
export function computeSlots(config: SignupConfig): string[] {
  const { signupEnabled, signupSlotMinutes, signupStartTime, signupEndTime } = config;
  if (!signupEnabled || !signupSlotMinutes || signupSlotMinutes <= 0 || !signupStartTime || !signupEndTime) return [];
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const start = toMinutes(signupStartTime);
  const end = toMinutes(signupEndTime);
  const out: string[] = [];
  for (let t = start; t <= end - signupSlotMinutes; t += signupSlotMinutes) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

/** A slot the UI renders + signs up against, normalized across both modes. */
export interface SlotView {
  /** Stable per-slot key — the slot_id (slots mode) or the "HH:MM" (interval). */
  key: string;
  /** Set only in slots mode. */
  slotId: string | null;
  /** "HH:MM" — the interval slot_start, or the explicit slot's start. */
  slotStart: string | null;
  /** Human label, e.g. "Mon, Jul 13 · 10:50 AM". */
  label: string;
  /** Per-slot capacity (already resolved from the slot or the event default). */
  capacity: number;
  /** True when a signup row matches this slot. */
  matches: (s: ScheduleSignup) => boolean;
}

/** Build a slot label from a day (ISO) + start/end "HH:MM", with an optional
 *  override. Falls back to just the time when there's no day. */
function slotLabel(day: string | null | undefined, start: string, end: string | null, override?: string | null): string {
  if (override && override.trim()) return override.trim();
  const time = end ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start);
  return day ? `${formatDate(day)} · ${time}` : time;
}

/** The list of slots to render for an event, in either mode. In interval mode
 *  the event's own day labels every slot; in slots mode each explicit row
 *  carries its own day. */
export function resolveSlotViews(event: ScheduleEvent, slots: ScheduleSlot[]): SlotView[] {
  const defaultCap = event.signupCapacity ?? 0;
  if (event.signupMode === "slots") {
    return slots.map((sl) => ({
      key: sl.id,
      slotId: sl.id,
      slotStart: sl.startTime,
      label: slotLabel(sl.day ?? event.day, sl.startTime, sl.endTime, sl.label),
      capacity: sl.capacity ?? defaultCap,
      matches: (s) => s.slotId === sl.id,
    }));
  }
  return computeSlots(event).map((start) => ({
    key: start,
    slotId: null,
    slotStart: start,
    label: slotLabel(event.day, start, null, null),
    capacity: defaultCap,
    matches: (s) => !s.slotId && s.slotStart === start,
  }));
}

/** All sign-ups across every slot of one event. Empty with no backend. */
export async function fetchScheduleSignups(scheduleItemId: string): Promise<ScheduleSignup[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_schedule_signups")
    .select("id, slot_start, slot_id, user_id, name, added_by, fields")
    .eq("schedule_item_id", scheduleItemId)
    .order("created_at");
  return ((data ?? []) as ScheduleSignupRow[]).map((r) => ({
    id: r.id,
    slotStart: r.slot_start,
    slotId: r.slot_id,
    userId: r.user_id,
    name: r.name,
    addedBy: r.added_by,
    fields: r.fields ?? {},
  }));
}

/** Sign someone up for a slot. Pass `slotId` (slots mode) or `slotStart`
 *  (interval mode). Link a member with `forUserId`, or type a `name`; neither
 *  ⇒ the caller. `fields` carries the event's custom-column values. */
export async function signUpForSlot(
  scheduleItemId: string,
  opts: {
    slotStart?: string | null;
    slotId?: string | null;
    forUserId?: string;
    name?: string;
    fields?: Record<string, string>;
  } = {},
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("sign_up_for_schedule_slot", {
    p_item: scheduleItemId,
    p_slot: opts.slotStart ?? null,
    p_for_user: opts.forUserId ?? null,
    p_name: opts.name ?? null,
    p_slot_id: opts.slotId ?? null,
    p_fields: opts.fields ?? {},
  });
  return error ? { error: error.message } : {};
}

export async function removeScheduleSignup(signupId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("remove_schedule_signup", { p_signup: signupId });
  return error ? { error: error.message } : {};
}

// ── Explicit slots (signup_mode = 'slots') — organizer-managed via RLS ────────

export async function fetchScheduleSlots(scheduleItemId: string): Promise<ScheduleSlot[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_schedule_slots")
    .select("id, schedule_item_id, day, start_time, end_time, label, capacity, position")
    .eq("schedule_item_id", scheduleItemId)
    .order("position")
    .order("start_time");
  return ((data ?? []) as ScheduleSlotRow[]).map((r) => ({
    id: r.id,
    scheduleItemId: r.schedule_item_id,
    day: r.day,
    startTime: r.start_time,
    endTime: r.end_time,
    label: r.label,
    capacity: r.capacity,
    position: r.position,
  }));
}

export async function createScheduleSlot(
  scheduleItemId: string,
  slot: { day: string | null; startTime: string; endTime: string | null; label: string | null; capacity: number | null; position: number },
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("fest_schedule_slots").insert({
    schedule_item_id: scheduleItemId,
    day: slot.day,
    start_time: slot.startTime,
    end_time: slot.endTime,
    label: slot.label,
    capacity: slot.capacity,
    position: slot.position,
  });
  return error ? { error: error.message } : {};
}

export async function deleteScheduleSlot(slotId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("fest_schedule_slots").delete().eq("id", slotId);
  return error ? { error: error.message } : {};
}
