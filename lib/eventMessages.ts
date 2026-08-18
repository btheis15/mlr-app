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
  /** Also email family on the roster who don't have an app account yet —
   *  family_roster / committee_roster slots with an email but no linked
   *  account (default true). */
  includeRoster?: boolean;
}

/** Queue the email. Resolves with how many members it will reach (opted into
 *  email alerts, approved, plus account-less rostered family, minus "can't make
 *  it" when that's on) — the row is
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
    p_include_roster: input.includeRoster ?? true,
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

/**
 * A starting draft for the note, built ONLY from what's already stored.
 *
 * ⚠️ RULE: this may restate facts the event itself carries — its title, dates,
 * location — and nothing else. It must never invent a commitment nobody made
 * ("lunch is covered", "bring a drill", "materials are bought"). The sender is
 * the only source for anything beyond the record, and this is a draft they edit
 * before sending, not a substitute for them.
 *
 * Deliberately says nothing about how many tasks there are: a house member and
 * a non-member get different lists, and the email already prints an accurate
 * per-copy count line. A number typed into the shared note body would appear in
 * every version and contradict it (see the bucketing note in migration 0190).
 *
 * The "let us know if you can make it" ask is NOT here either — the email
 * template renders that unconditionally, so putting it in the draft too would
 * just say it twice.
 */
export function suggestEventNote(event: {
  title: string;
  when?: string | null;
  location?: string | null;
  description?: string | null;
}): string {
  const title = event.title?.trim() || "this";
  const when = event.when?.trim();
  const location = event.location?.trim();

  const opener = when
    ? `${title} is ${when}${location ? ` at ${location}` : ""}.`
    : `${title} is coming up${location ? ` at ${location}` : ""}.`;

  // Skip this line when the event's own description already says what it's
  // for — the email prints that under "About" right above the note.
  const context = event.description?.trim()
    ? ""
    : " Here's what's planned so far.";

  return `Hi everyone — ${opener}${context}\n\nEverything on the list is below. Hope to see you up there.`;
}

/** One house's version of the email, as the preview reports it — same shape the
 *  mailer gets, but with a recipient COUNT instead of the addresses. */
export interface EventMessagePreviewHouse {
  houseId: string | null;
  name: string | null;
  emoji: string | null;
  items: unknown[] | null;
  recipients: number;
}

export interface EventMessagePreview {
  senderName: string | null;
  senderEmail: string | null;
  eventId: string;
  eventTitle: string;
  eventWhen: string | null;
  eventEmoji: string | null;
  eventLocation: string | null;
  eventDescription: string | null;
  mlrItems: unknown[] | null;
  houseGroups: EventMessagePreviewHouse[];
  generalRecipients: number;
}

/**
 * Dry-run the send: what the email will say, and how many people each version
 * reaches (migration 0192, `event_message_preview`).
 *
 * ⚠️ This deliberately comes from the DATABASE rather than being assembled on
 * the client. Which items are open, how they rank, and above all how people are
 * bucketed into per-house versions is decided in SQL — and a house-scoped item
 * is RLS-invisible to a non-member, so a client-built preview would show a
 * different email than the one that actually sends. It returns no addresses,
 * only counts.
 */
export async function fetchEventMessagePreview(
  input: Pick<EventMessageInput, "eventId" | "eventTitle" | "eventWhen" | "includeWorkItems" | "excludeNotAttending" | "includeRoster">,
): Promise<{ preview?: EventMessagePreview; error?: string }> {
  if (!isSupabaseConfigured || !supabase) return { error: "Not connected" };
  const { data, error } = await supabase.rpc("event_message_preview", {
    p_event_id: input.eventId,
    p_event_title: input.eventTitle,
    p_event_when: input.eventWhen ?? null,
    p_include_work_items: input.includeWorkItems ?? true,
    p_exclude_not_attending: input.excludeNotAttending ?? true,
    p_include_roster: input.includeRoster ?? true,
  });
  if (error) {
    // Pre-migration (function not found) — the composer falls back to sending
    // without a preview rather than blocking the feature entirely.
    if (error.code === "PGRST202") return { error: "unavailable" };
    return { error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { error: "Couldn't build a preview" };
  return {
    preview: {
      senderName: row.sender_name ?? null,
      senderEmail: row.sender_email ?? null,
      eventId: row.event_id,
      eventTitle: row.event_title,
      eventWhen: row.event_when ?? null,
      eventEmoji: row.event_emoji ?? null,
      eventLocation: row.event_location ?? null,
      eventDescription: row.event_description ?? null,
      mlrItems: row.mlr_items ?? null,
      houseGroups: Array.isArray(row.house_groups) ? row.house_groups : [],
      generalRecipients: row.general_recipients ?? 0,
    },
  };
}
