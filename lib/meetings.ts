// Client helpers for committee/house meeting scheduling (migration 0116). An
// organizer (admin, or a committee/area Lead) proposes candidate time slots in a
// committee or house chat room; every member marks Yes / If-need-be / No per slot
// (Doodle-style); the organizer sees the tallies + best slot, finalizes a time,
// and pastes in a Google Meet link. Reads go through the Supabase client
// (members-only tables under RLS, scoped to the room via can_access_committee_area
// / is_house_member); writes go through SECURITY DEFINER RPCs so the
// organizer / one-row-per-member / closed rules live server-side.
//
// Everything degrades to safe no-ops with no backend, and a missing table
// (42P01 — the 0116 migration hasn't run yet) reads as "no meetings" — the same
// idiom as lib/polls.ts.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type AvailabilityStatus = "yes" | "if_need_be" | "no";
export type MeetingStatus = "open" | "scheduled" | "cancelled";

/** Which room a meeting lives in — drives both the fetch filter and create args. */
export type MeetingScope =
  | { type: "committee"; committeeId: string; slug: string; area: string | null }
  | { type: "house"; houseId: string; slug: string };

export interface MeetingSlot {
  id: string;
  startsAt: string;
  durationMin: number;
  position: number;
  /** Member ids in each bucket (resolve names against the room roster). */
  yes: string[];
  ifNeedBe: string[];
  no: string[];
  /** yes*1 + if_need_be*0.5 — the ranking used to pick the best time. */
  score: number;
}

export interface Meeting {
  id: string;
  scopeType: "committee" | "house";
  committeeSlug: string | null;
  area: string | null;
  houseId: string | null;
  title: string;
  description: string | null;
  createdBy: string | null;
  /** True when the viewer created it (drives Finalize/Cancel/Delete alongside isAdmin). */
  createdByMe: boolean;
  createdAt: string;
  respondBy: string | null;
  status: MeetingStatus;
  chosenSlotId: string | null;
  meetUrl: string | null;
  slots: MeetingSlot[];
  /** The viewer's own answer per slot id. */
  myAnswers: Record<string, AvailabilityStatus>;
  /** Slot id with the highest score (ties → earliest), or null if no slots. */
  bestSlotId: string | null;
  /** Distinct members who have answered at least one slot. */
  respondentCount: number;
}

export interface MeetingSlotInput {
  /** ISO timestamp (with offset) for the slot start. */
  startsAt: string;
  durationMin?: number;
}

export interface MeetingInput {
  scope: MeetingScope;
  title: string;
  description?: string | null;
  slots: MeetingSlotInput[];
  respondBy?: string | null;
}

type PgError = { code?: string; message?: string } | null;

/** Missing relation ⇒ the 0116 migration hasn't run yet (same 42P01 check as
 *  lib/polls.ts). */
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

interface MeetingRow {
  id: string;
  scope_type: "committee" | "house";
  committee_slug: string | null;
  area: string | null;
  house_id: string | null;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  respond_by: string | null;
  status: MeetingStatus;
  chosen_slot_id: string | null;
  meet_url: string | null;
  meeting_slots: { id: string; starts_at: string; duration_min: number; position: number }[] | null;
}

interface AvailabilityRow {
  meeting_id: string;
  slot_id: string;
  user_id: string;
  status: AvailabilityStatus;
}

/**
 * Every meeting for a room (newest first) with its slots, per-slot availability
 * buckets, the best slot, and the viewer's own answers — all computed
 * client-side from one meeting_availability read (members-only under RLS, so a
 * guest / non-member simply gets []). Empty with no backend, pre-migration
 * (42P01), or on any read failure — never throws.
 */
export async function fetchMeetingsForRoom(scope: MeetingScope): Promise<Meeting[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    let q = sb
      .from("meetings")
      .select(
        "id, scope_type, committee_slug, area, house_id, title, description, created_by, created_at, respond_by, status, chosen_slot_id, meet_url, meeting_slots(id, starts_at, duration_min, position)"
      )
      .order("created_at", { ascending: false });

    if (scope.type === "committee") {
      q = q.eq("scope_type", "committee").eq("committee_slug", scope.slug);
      q = scope.area == null ? q.is("area", null) : q.eq("area", scope.area);
    } else {
      q = q.eq("scope_type", "house").eq("house_id", scope.houseId);
    }

    const [meetingsRes, userRes] = await Promise.all([q, sb.auth.getUser()]);
    if (meetingsRes.error) {
      if (!isMissingTable(meetingsRes.error)) {
        console.warn("fetchMeetingsForRoom: read error", meetingsRes.error.message);
      }
      return [];
    }
    const rows = (meetingsRes.data ?? []) as MeetingRow[];
    if (rows.length === 0) return [];
    const uid = userRes.data.user?.id ?? null;

    // One availability read for all these meetings.
    const ids = rows.map((r) => r.id);
    const availRes = await sb
      .from("meeting_availability")
      .select("meeting_id, slot_id, user_id, status")
      .in("meeting_id", ids);
    const avail = (availRes.error ? [] : (availRes.data ?? [])) as AvailabilityRow[];

    // Index availability per slot + per (meeting,user) for "mine" and respondents.
    const bySlot: Record<string, { yes: string[]; ifNeedBe: string[]; no: string[] }> = {};
    const mineByMeeting: Record<string, Record<string, AvailabilityStatus>> = {};
    const respondersByMeeting: Record<string, Set<string>> = {};
    for (const a of avail) {
      const b = (bySlot[a.slot_id] ??= { yes: [], ifNeedBe: [], no: [] });
      if (a.status === "yes") b.yes.push(a.user_id);
      else if (a.status === "if_need_be") b.ifNeedBe.push(a.user_id);
      else b.no.push(a.user_id);
      (respondersByMeeting[a.meeting_id] ??= new Set()).add(a.user_id);
      if (uid && a.user_id === uid) (mineByMeeting[a.meeting_id] ??= {})[a.slot_id] = a.status;
    }

    return rows.map((r) => {
      const slots: MeetingSlot[] = (r.meeting_slots ?? [])
        .slice()
        .sort((a, b) => a.position - b.position || a.starts_at.localeCompare(b.starts_at))
        .map((s) => {
          const b = bySlot[s.id] ?? { yes: [], ifNeedBe: [], no: [] };
          return {
            id: s.id,
            startsAt: s.starts_at,
            durationMin: s.duration_min,
            position: s.position,
            yes: b.yes,
            ifNeedBe: b.ifNeedBe,
            no: b.no,
            score: b.yes.length + b.ifNeedBe.length * 0.5,
          };
        });
      // Best = highest score; ties broken by the earlier start.
      let bestSlotId: string | null = null;
      let bestScore = -1;
      for (const s of slots) {
        if (s.score > bestScore) {
          bestScore = s.score;
          bestSlotId = s.id;
        }
      }
      return {
        id: r.id,
        scopeType: r.scope_type,
        committeeSlug: r.committee_slug,
        area: r.area,
        houseId: r.house_id,
        title: r.title,
        description: r.description,
        createdBy: r.created_by,
        createdByMe: !!uid && r.created_by === uid,
        createdAt: r.created_at,
        respondBy: r.respond_by,
        status: r.status,
        chosenSlotId: r.chosen_slot_id,
        meetUrl: r.meet_url,
        slots,
        myAnswers: mineByMeeting[r.id] ?? {},
        bestSlotId,
        respondentCount: respondersByMeeting[r.id]?.size ?? 0,
      };
    });
  } catch {
    return [];
  }
}

/** A meeting with the viewer's answers merged in + slot buckets/score/best
 *  recomputed — the optimistic local update the sheet paints before
 *  set_my_availability confirms. `answers` is a partial {slotId: status} map;
 *  slots it omits keep the viewer's existing answer. */
export function applyMyAvailability(
  meeting: Meeting,
  uid: string,
  answers: Record<string, AvailabilityStatus>
): Meeting {
  const myAnswers = { ...meeting.myAnswers, ...answers };
  const slots = meeting.slots.map((s) => {
    const next = myAnswers[s.id];
    // Drop me from every bucket, then re-add per my new answer.
    const yes = s.yes.filter((u) => u !== uid);
    const ifNeedBe = s.ifNeedBe.filter((u) => u !== uid);
    const no = s.no.filter((u) => u !== uid);
    if (next === "yes") yes.push(uid);
    else if (next === "if_need_be") ifNeedBe.push(uid);
    else if (next === "no") no.push(uid);
    return { ...s, yes, ifNeedBe, no, score: yes.length + ifNeedBe.length * 0.5 };
  });
  let bestSlotId: string | null = null;
  let bestScore = -1;
  for (const s of slots) {
    if (s.score > bestScore) {
      bestScore = s.score;
      bestSlotId = s.id;
    }
  }
  const responders = new Set<string>();
  for (const s of slots) [...s.yes, ...s.ifNeedBe, ...s.no].forEach((u) => responders.add(u));
  return { ...meeting, myAnswers, slots, bestSlotId, respondentCount: responders.size };
}

/** Propose a meeting — admin, or a committee/area Lead. Returns the new id or an
 *  error message. */
export async function createMeeting(input: MeetingInput): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { scope } = input;
  const { data, error } = await sb.rpc("create_meeting", {
    p_scope: scope.type,
    p_committee_id: scope.type === "committee" ? scope.committeeId : null,
    p_area: scope.type === "committee" ? scope.area : null,
    p_house_id: scope.type === "house" ? scope.houseId : null,
    p_title: input.title,
    p_description: input.description ?? null,
    p_slots: input.slots.map((s) => ({ starts_at: s.startsAt, duration_min: s.durationMin ?? 60 })),
    p_respond_by: input.respondBy ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Set (or change) my availability — bulk upsert of my own rows. `answers` is a
 *  {slotId: status} map; the server rejects a closed meeting. */
export async function setMyAvailability(
  meetingId: string,
  answers: Record<string, AvailabilityStatus>
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("set_my_availability", { p_meeting: meetingId, p_answers: answers });
  return error ? { error: error.message } : {};
}

/** Finalize — pick the winning slot + attach the Meet link — organizer or admin. */
export async function finalizeMeeting(
  meetingId: string,
  slotId: string,
  meetUrl: string
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("finalize_meeting", {
    p_meeting: meetingId,
    p_slot: slotId,
    p_meet_url: meetUrl,
  });
  return error ? { error: error.message } : {};
}

/** Cancel a meeting (keep the record) — organizer or admin. */
export async function cancelMeeting(meetingId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("cancel_meeting", { p_meeting: meetingId });
  return error ? { error: error.message } : {};
}

/** Delete a meeting (slots + availability cascade) — organizer or admin. */
export async function deleteMeeting(meetingId: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("delete_meeting", { p_meeting: meetingId });
  return error ? { error: error.message } : {};
}

/** Can the viewer propose a meeting in this room? Admin (any room) or — for a
 *  committee — a Lead of that committee/area. Asks the server (can_organize_meeting)
 *  so the button visibility can't drift from the RLS gate. False on no-config or
 *  any error (pre-migration included). */
export async function fetchCanOrganize(scope: MeetingScope): Promise<boolean> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return false;
  try {
    const { data, error } = await sb.rpc("can_organize_meeting", {
      p_scope: scope.type,
      p_committee_id: scope.type === "committee" ? scope.committeeId : null,
      p_area: scope.type === "committee" ? scope.area : null,
      p_house_id: scope.type === "house" ? scope.houseId : null,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** UTC compact stamp for a Google Calendar `dates` param: 20260720T143000Z. */
function gcalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * A prefilled Google Calendar "create event" link (TEMPLATE action, no OAuth).
 * The organizer taps it, adds Google Meet in the created event, saves, then
 * pastes the resulting Meet link back into the app — the same "create
 * externally, paste link back" convention as the admin "Create a Google Form"
 * card (app/admin/page.tsx). Works on a phone with whatever Google account is
 * already signed in.
 */
export function googleCalendarCreateUrl(opts: {
  title: string;
  startsAt: string;
  durationMin: number;
  details?: string;
}): string {
  const start = new Date(opts.startsAt);
  const end = new Date(start.getTime() + opts.durationMin * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${gcalStamp(start)}/${gcalStamp(end)}`,
  });
  if (opts.details) params.set("details", opts.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Lightweight check that a pasted string looks like a Meet / Calendar link. */
export function looksLikeMeetLink(value: string): boolean {
  const v = value.trim();
  return /^https?:\/\//i.test(v) && /(meet\.google\.com|calendar\.google\.com|goo\.gl)/i.test(v);
}
