// Client seam for scheduling a banner announcement or broadcast notification
// for a future time (migration 0097). The actual send happens inside Postgres
// via pg_cron, not this app or the mac mini — see run_scheduled_broadcasts()
// in the migration — so this module is just queue CRUD: schedule, list,
// cancel. `payload` intentionally mirrors what AdminAlertComposer /
// AdminNotificationComposer already collect, so scheduling reuses the same
// shape instead of inventing a second one.

import { supabase } from "@/lib/supabase";

export type BroadcastKind = "announcement" | "notification";

/** Everything either composer might stash in `payload` — each kind only uses
 *  a subset (see run_scheduled_broadcasts' per-kind branch in the migration). */
export interface BroadcastPayload {
  title: string;
  body?: string | null;
  url?: string | null;
  audience?: "everyone" | "admins";
  expiryHours?: number | null;
  notifyEmail?: boolean;
  emailAudience?: "all" | "admins";
  alsoBanner?: boolean;
  eventId?: string | null;
  excludeNotAttending?: boolean;
  /** Set when this queued item is a reminder generated from an event/callout's
   *  "Reminders" section (see ReminderScheduler) rather than composed directly
   *  in the Alerts screen — lets the event/callout editor list "reminders for
   *  this item" and the admin queue show what a reminder is attached to.
   *  Opaque to run_scheduled_broadcasts(); purely a client-side label. */
  sourceType?: "event" | "callout" | null;
  sourceId?: string | null;
  sourceLabel?: string | null;
}

export interface ScheduledBroadcast {
  id: string;
  kind: BroadcastKind;
  payload: BroadcastPayload;
  scheduledAt: string;
  sentAt: string | null;
  cancelledAt: string | null;
  error: string | null;
  createdAt: string;
}

interface ScheduledBroadcastRow {
  id: string;
  kind: BroadcastKind;
  payload: BroadcastPayload;
  scheduled_at: string;
  sent_at: string | null;
  cancelled_at: string | null;
  error: string | null;
  created_at: string;
}

function mapRow(r: ScheduledBroadcastRow): ScheduledBroadcast {
  return {
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    cancelledAt: r.cancelled_at,
    error: r.error,
    createdAt: r.created_at,
  };
}

/** Queue one up for later. `scheduledAt` is an ISO timestamp in the future. */
export async function scheduleBroadcast(
  kind: BroadcastKind,
  payload: BroadcastPayload,
  scheduledAt: string,
): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("schedule_broadcast", {
    p_kind: kind,
    p_payload: payload,
    p_scheduled_at: scheduledAt,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** The queue (admin-only, RLS-gated) — pending + recently sent/failed, newest
 *  scheduled-time first, so an admin can see what's about to fire and what
 *  just went out. Cancelled rows are omitted; nothing purges them server-side
 *  so they stay in the table as a quiet audit trail. */
export async function fetchScheduledBroadcasts(): Promise<ScheduledBroadcast[]> {
  const sb = supabase;
  if (!sb) return [];
  const { data } = await sb
    .from("scheduled_broadcasts")
    .select("id, kind, payload, scheduled_at, sent_at, cancelled_at, error, created_at")
    .is("cancelled_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(100);
  return ((data ?? []) as ScheduledBroadcastRow[]).map(mapRow);
}

/** Pull one out of the queue before it fires — no-op (silently) if it already
 *  sent by the time this lands. */
export async function cancelScheduledBroadcast(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("cancel_scheduled_broadcast", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Edit a still-pending queued item's content/send time in place (migration
 *  0101). Fails if it's already sent or been cancelled. */
export async function updateScheduledBroadcast(
  id: string,
  payload: BroadcastPayload,
  scheduledAt: string,
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("update_scheduled_broadcast", {
    p_id: id,
    p_payload: payload,
    p_scheduled_at: scheduledAt,
  });
  return error ? { error: error.message } : {};
}

/** The pending/recent reminders attached to one event/callout (matched on
 *  payload.sourceType + sourceId), oldest-first — for the "Reminders" list
 *  embedded in EventComposer/AdminCallouts. */
export async function fetchScheduledBroadcastsBySource(
  sourceType: "event" | "callout",
  sourceId: string,
): Promise<ScheduledBroadcast[]> {
  const sb = supabase;
  if (!sb) return [];
  const { data } = await sb
    .from("scheduled_broadcasts")
    .select("id, kind, payload, scheduled_at, sent_at, cancelled_at, error, created_at")
    .is("cancelled_at", null)
    .contains("payload", { sourceType, sourceId })
    .order("scheduled_at", { ascending: true });
  return ((data ?? []) as ScheduledBroadcastRow[]).map(mapRow);
}
