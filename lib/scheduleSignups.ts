// Limited sign-up time slots for a schedule event (migration 0135) — e.g. "4
// people per slot, every hour from noon to 4pm." The slot list itself isn't
// stored anywhere; it's derived here from the event's own signup* config, the
// same values the sign_up_for_schedule_slot() RPC re-derives server-side for
// validation, so the two never disagree on what a "slot" is.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ScheduleEvent } from "@/lib/types";

export interface ScheduleSignup {
  id: string;
  slotStart: string; // "HH:MM"
  userId: string | null;
  name: string;
  addedBy: string | null;
}

interface ScheduleSignupRow {
  id: string;
  slot_start: string;
  user_id: string | null;
  name: string;
  added_by: string | null;
}

/** The event's config needed to compute its slot list. */
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

/** All sign-ups across every slot of one event. Empty with no backend. */
export async function fetchScheduleSignups(scheduleItemId: string): Promise<ScheduleSignup[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_schedule_signups")
    .select("id, slot_start, user_id, name, added_by")
    .eq("schedule_item_id", scheduleItemId)
    .order("created_at");
  return ((data ?? []) as ScheduleSignupRow[]).map((r) => ({
    id: r.id,
    slotStart: r.slot_start,
    userId: r.user_id,
    name: r.name,
    addedBy: r.added_by,
  }));
}

/** Claim a slot for myself (default), or — organizer only — for another member
 *  (`forUserId`) or a free-text, account-less name (`name`). */
export async function signUpForSlot(
  scheduleItemId: string,
  slotStart: string,
  opts: { forUserId?: string; name?: string } = {},
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("sign_up_for_schedule_slot", {
    p_item: scheduleItemId,
    p_slot: slotStart,
    p_for_user: opts.forUserId ?? null,
    p_name: opts.name ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function removeScheduleSignup(signupId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("remove_schedule_signup", { p_signup: signupId });
  return error ? { error: error.message } : {};
}
