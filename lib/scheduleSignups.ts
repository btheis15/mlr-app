// Sign-up time slots for a fest schedule event OR an "anytime" activity. Both
// share the exact same feature (migrations 0135/0136 for schedule events;
// migration 0138 brought it to activities) — two modes (derived "interval"
// slots or an arbitrary "slots" list), instructions, custom required columns,
// and "anyone can sign up anyone." The only difference is which tables/RPCs
// back it, selected by `kind` here.
//
// A sign-up is one person per row: a linked member OR a typed name, plus a
// value for each admin-defined custom column (target.signupFields).

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { SignupField } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/format";

export type SignupKind = "schedule" | "activity";

/** Per-kind table/column/RPC names — the one place the two flavors diverge. */
const SOURCES: Record<
  SignupKind,
  { signups: string; slots: string; parentCol: string; signRpc: string; removeRpc: string }
> = {
  schedule: {
    signups: "fest_schedule_signups",
    slots: "fest_schedule_slots",
    parentCol: "schedule_item_id",
    signRpc: "sign_up_for_schedule_slot",
    removeRpc: "remove_schedule_signup",
  },
  activity: {
    signups: "fest_activity_signups",
    slots: "fest_activity_slots",
    parentCol: "activity_id",
    signRpc: "sign_up_for_activity_slot",
    removeRpc: "remove_activity_signup",
  },
};

/** The minimal shape both ScheduleEvent and FestActivity satisfy for sign-ups. */
export interface SignupTarget {
  id: string;
  /** Schedule events have a day; activities don't (undefined). */
  day?: string;
  signupEnabled?: boolean;
  signupCapacity?: number | null;
  signupSlotMinutes?: number | null;
  signupStartTime?: string | null;
  signupEndTime?: string | null;
  /** "headcount" (schedule events only, migration 0143) has no time
   *  dimension — see resolveSlotViews. */
  signupMode?: "interval" | "slots" | "headcount" | null;
  signupInstructions?: string | null;
  signupFields?: SignupField[] | null;
  /** Sign up as a fixed-size team instead of individually (migration 0143,
   *  schedule events only). Null/1 = individual. */
  signupTeamSize?: number | null;
  /** Hide individual names from other members (migration 0167, schedule
   *  events only) — everyone still sees an accurate headcount. */
  signupHideNames?: boolean;
}

export interface ScheduleSignup {
  id: string;
  slotStart: string | null;
  slotId: string | null;
  userId: string | null;
  name: string;
  addedBy: string | null;
  fields: Record<string, string>;
  /** Shared by every row of one team sign-up; null for an individual (schedule
   *  events only, migration 0143). */
  teamId: string | null;
  teamName: string | null;
}

interface ScheduleSignupRow {
  id: string;
  slot_start: string | null;
  slot_id: string | null;
  user_id: string | null;
  name: string;
  added_by: string | null;
  fields: Record<string, string> | null;
  team_id?: string | null;
  team_name?: string | null;
}

export interface ScheduleSlot {
  id: string;
  day: string | null;
  startTime: string;
  endTime: string | null;
  label: string | null;
  capacity: number | null;
  position: number;
}

interface ScheduleSlotRow {
  id: string;
  day: string | null;
  start_time: string;
  end_time: string | null;
  label: string | null;
  capacity: number | null;
  position: number;
}

/** The config needed to compute an interval-mode slot list. */
export type SignupConfig = Pick<
  SignupTarget,
  "signupEnabled" | "signupCapacity" | "signupSlotMinutes" | "signupStartTime" | "signupEndTime"
>;

/** "HH:MM" start times from signupStartTime up to (not reaching) signupEndTime,
 *  signupSlotMinutes apart. Mirrors the *_slot_starts() Postgres functions. */
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

/** A slot the UI renders + signs up against, normalized across all modes.
 *  `capacity: null` ⇒ no cap (headcount mode only, when the creator left it
 *  blank) — just a running count, never "full". */
export interface SlotView {
  key: string;
  slotId: string | null;
  slotStart: string | null;
  /** Empty for the single headcount bucket — there's no time/label to show,
   *  the UI's own "Sign up" heading covers it. */
  label: string;
  capacity: number | null;
  matches: (s: ScheduleSignup) => boolean;
}

function slotLabel(day: string | null | undefined, start: string, end: string | null, override?: string | null): string {
  if (override && override.trim()) return override.trim();
  const time = end ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start);
  return day ? `${formatDate(day)} · ${time}` : time;
}

/** The list of slots to render for a target, in any mode. Headcount mode
 *  (migration 0143) always resolves to exactly one view — the event's single
 *  "no slot" bucket — with no time dimension at all. */
export function resolveSlotViews(target: SignupTarget, slots: ScheduleSlot[]): SlotView[] {
  const defaultCap = target.signupCapacity ?? 0;
  if (target.signupMode === "headcount") {
    return [
      {
        key: "headcount",
        slotId: null,
        slotStart: null,
        label: "",
        capacity: target.signupCapacity ?? null,
        matches: (s) => !s.slotId && !s.slotStart,
      },
    ];
  }
  if (target.signupMode === "slots") {
    return slots.map((sl) => ({
      key: sl.id,
      slotId: sl.id,
      slotStart: sl.startTime,
      label: slotLabel(sl.day ?? target.day, sl.startTime, sl.endTime, sl.label),
      capacity: sl.capacity ?? defaultCap,
      matches: (s) => s.slotId === sl.id,
    }));
  }
  return computeSlots(target).map((start) => ({
    key: start,
    slotId: null,
    slotStart: start,
    label: slotLabel(target.day, start, null, null),
    capacity: defaultCap,
    matches: (s) => !s.slotId && s.slotStart === start,
  }));
}

/** All sign-ups across every slot of one target. Empty with no backend. */
export async function fetchScheduleSignups(kind: SignupKind, parentId: string): Promise<ScheduleSignup[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const src = SOURCES[kind];
  // team_id/team_name (migration 0143) only exist on fest_schedule_signups —
  // activities weren't extended with headcount/teams (see scheduleSignups.ts
  // header + the migration's own scoping note).
  const columns =
    kind === "schedule"
      ? "id, slot_start, slot_id, user_id, name, added_by, fields, team_id, team_name"
      : "id, slot_start, slot_id, user_id, name, added_by, fields";
  const { data } = await sb
    .from(src.signups)
    .select(columns)
    .eq(src.parentCol, parentId)
    .order("created_at");
  return ((data ?? []) as unknown as ScheduleSignupRow[]).map((r) => ({
    id: r.id,
    slotStart: r.slot_start,
    slotId: r.slot_id,
    userId: r.user_id,
    name: r.name,
    addedBy: r.added_by,
    fields: r.fields ?? {},
    teamId: r.team_id ?? null,
    teamName: r.team_name ?? null,
  }));
}

/** A per-slot headcount keyed the same way SlotView.key is built ("headcount",
 *  a slot id, or an interval "HH:MM" start) — accurate even when
 *  `signupHideNames` hides other people's rows from a plain select (migration
 *  0167; the RPC is SECURITY DEFINER so it counts every row regardless of RLS).
 *  Schedule events only — activities never got the hide-names option. */
export async function fetchScheduleSignupCounts(kind: SignupKind, parentId: string): Promise<Record<string, number>> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || kind !== "schedule") return {};
  const { data } = await sb.rpc("fest_schedule_signup_counts", { p_item: parentId });
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { slot_start: string | null; slot_id: string | null; cnt: number }[]) {
    const key = row.slot_id ?? row.slot_start ?? "headcount";
    out[key] = (out[key] ?? 0) + Number(row.cnt);
  }
  return out;
}

/** One member of a team sign-up (migration 0143, schedule events only) —
 *  link a member with `forUserId`, or type a `name`; neither ⇒ the caller. */
export interface TeamMember {
  forUserId?: string;
  name?: string;
  fields?: Record<string, string>;
}

/** Sign someone up for a slot. Pass `slotId` (slots mode), `slotStart`
 *  (interval mode), or neither (headcount mode's single bucket). Link a
 *  member with `forUserId`, or type a `name`; neither ⇒ the caller. `fields`
 *  carries the custom-column values. Pass `teamMembers` (schedule events
 *  only) instead of `forUserId`/`name`/`fields` to sign up a whole team at
 *  once, sharing an optional `teamName`. */
export async function signUpForSlot(
  kind: SignupKind,
  parentId: string,
  opts: {
    slotStart?: string | null;
    slotId?: string | null;
    forUserId?: string;
    name?: string;
    fields?: Record<string, string>;
    teamMembers?: TeamMember[];
    teamName?: string | null;
  } = {},
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const teamParams =
    kind === "schedule"
      ? {
          p_team_members: opts.teamMembers?.length
            ? opts.teamMembers.map((m) => ({ for_user: m.forUserId ?? null, name: m.name ?? null, fields: m.fields ?? {} }))
            : null,
          p_team_name: opts.teamName?.trim() || null,
        }
      : {};
  const { error } = await sb.rpc(SOURCES[kind].signRpc, {
    p_item: parentId,
    p_slot: opts.slotStart ?? null,
    p_for_user: opts.forUserId ?? null,
    p_name: opts.name ?? null,
    p_slot_id: opts.slotId ?? null,
    p_fields: opts.fields ?? {},
    ...teamParams,
  });
  return error ? { error: error.message } : {};
}

export async function removeScheduleSignup(kind: SignupKind, signupId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc(SOURCES[kind].removeRpc, { p_signup: signupId });
  return error ? { error: error.message } : {};
}

/** On-demand "your time is soon" nudge (migration 0158) for everyone signed
 *  up in ONE slot — a manual, immediate send, distinct from the fully
 *  automatic pre-configured `signup_reminder_minutes` cron (0140). `minutes`
 *  is descriptive only (e.g. 60 -> "starts in 1 hour" in the notification
 *  body); pass null/omit for a plain "is coming up" instead. Pass `email:
 *  true` to also queue a group email for anyone signed up with a linked
 *  account (migration 0159; sent by the mini's alert-mailer, not inline).
 *  Gated server-side to the item's creator predicate (can_edit_fest() OR its
 *  lead/crew). */
export async function sendSlotReminderNow(
  kind: SignupKind,
  parentId: string,
  opts: { slotId?: string | null; slotStart?: string | null; minutes?: number | null; email?: boolean },
): Promise<{ error?: string; count?: number }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("send_signup_slot_reminder_now", {
    p_kind: kind,
    p_item: parentId,
    p_slot_id: opts.slotId ?? null,
    p_slot_start: opts.slotId ? null : opts.slotStart ?? null,
    p_minutes: opts.minutes ?? null,
    p_email: opts.email ?? false,
  });
  return error ? { error: error.message } : { count: (data as number | null) ?? 0 };
}

// ── Explicit slots (signup_mode = 'slots') — organizer-managed via RLS ────────

export async function fetchScheduleSlots(kind: SignupKind, parentId: string): Promise<ScheduleSlot[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const src = SOURCES[kind];
  const { data } = await sb
    .from(src.slots)
    .select("id, day, start_time, end_time, label, capacity, position")
    .eq(src.parentCol, parentId)
    .order("day", { nullsFirst: true })
    .order("start_time");
  return ((data ?? []) as ScheduleSlotRow[]).map((r) => ({
    id: r.id,
    day: r.day,
    startTime: r.start_time,
    endTime: r.end_time,
    label: r.label,
    capacity: r.capacity,
    position: r.position,
  }));
}

export async function createScheduleSlot(
  kind: SignupKind,
  parentId: string,
  slot: { day: string | null; startTime: string; endTime: string | null; label: string | null; capacity: number | null; position: number },
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from(SOURCES[kind].slots).insert({
    [SOURCES[kind].parentCol]: parentId,
    day: slot.day,
    start_time: slot.startTime,
    end_time: slot.endTime,
    label: slot.label,
    capacity: slot.capacity,
    position: slot.position,
  });
  return error ? { error: error.message } : {};
}

export async function deleteScheduleSlot(kind: SignupKind, slotId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from(SOURCES[kind].slots).delete().eq("id", slotId);
  return error ? { error: error.message } : {};
}
