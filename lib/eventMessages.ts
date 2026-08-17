// Client seam for "email everyone about this event" (migration 0190). The send
// itself happens on the mac mini's alert-mailer, which watches event_messages
// and builds the laid-out email (event details + the resort-wide work items in
// full + a count line per house); this just queues the row. Gated server-side
// to the event's creator or an admin. Degrades to a clear error with no backend.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface EventMessageInput {
  /** Stable event id — a DB uuid or a seed slug like "family-fest-2026". */
  eventId: string;
  /** Snapshot so a seed/synthesized event (no `events` row) still has a title. */
  eventTitle: string;
  /** Pre-formatted date line, same snapshot reasoning. */
  eventWhen?: string | null;
  subject?: string | null;
  body?: string | null;
  /** List the event's work items in the email (default true). */
  includeWorkItems?: boolean;
  /** Skip anyone who RSVP'd "Can't make it" (default true — the 0096 rule). */
  excludeNotAttending?: boolean;
}

/** Queue the email. Resolves with how many members it will reach (opted into
 *  email alerts, approved, minus "can't make it" when that's on) — the row is
 *  picked up by the mini within seconds via Realtime, or on its next 3-minute
 *  sweep. */
export async function sendEventMessage(
  input: EventMessageInput,
): Promise<{ count?: number; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Not connected" };
  const { data, error } = await supabase.rpc("send_event_message", {
    p_event_id: input.eventId,
    p_event_title: input.eventTitle,
    p_event_when: input.eventWhen ?? null,
    p_subject: input.subject?.trim() || null,
    p_body: input.body?.trim() || null,
    p_include_work_items: input.includeWorkItems ?? true,
    p_exclude_not_attending: input.excludeNotAttending ?? true,
  });
  if (error) {
    // Pre-migration (the RPC doesn't exist yet) — say so plainly rather than
    // surfacing a raw "could not find the function" to a family member.
    if (error.code === "PGRST202" || /find the function|schema cache/i.test(error.message ?? "")) {
      return { error: "Event emails aren't set up on this app yet." };
    }
    return { error: error.message };
  }
  return { count: typeof data === "number" ? data : 0 };
}
