// Client seam for the "Notification Test" admin tool (Admin dashboard card,
// migrations 0156-0157): pinging one specific member with a test notification,
// and a lightweight per-member "Notifications confirmed" checklist for once an
// admin has watched it actually arrive on that person's phone. Degrades to
// empty/no-op rather than throwing when the migrations haven't run yet (same
// doctrine as lib/polls.ts, lib/meetings.ts, etc.).

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** Ping ONE specific member with a test notification (Activity tab + phone
 *  push, migration 0156) — for an admin checking that a member's own
 *  notification settings are actually working. Bypasses notif_types (like a
 *  broadcast) and rides an override push regardless of the recipient's
 *  per-category picks, since the point is testing the pipeline itself. */
export async function sendTestNotification(
  userId: string,
  title?: string,
  body?: string,
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("send_test_notification", {
    p_user: userId,
    p_title: title?.trim() || null,
    p_body: body?.trim() || null,
  });
  return error ? { error: error.message } : {};
}

export interface NotificationTestMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  confirmed: boolean;
  confirmedAt: string | null;
  /** Resolved from the same roster fetch — whoever last checked the box. */
  confirmedByName: string | null;
}

/** Every member, with the "Notifications confirmed" checklist state
 *  (migration 0157). Pre-migration (missing columns) degrades to the plain
 *  roster with every row unconfirmed, rather than failing outright. */
export async function fetchNotificationTestRoster(): Promise<NotificationTestMember[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];

  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name, avatar_url, notifications_confirmed, notifications_confirmed_at, notifications_confirmed_by")
    .order("display_name");

  if (error) {
    // Pre-0157: the three columns don't exist yet — fall back to a plain
    // name/avatar list so the picker/checklist still renders, just with
    // nothing confirmable until the migration runs.
    const { data: basic } = await sb.from("profiles").select("id, display_name, avatar_url").order("display_name");
    return ((basic ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => ({
      id: p.id,
      name: p.display_name || "Member",
      avatarUrl: p.avatar_url,
      confirmed: false,
      confirmedAt: null,
      confirmedByName: null,
    }));
  }

  type Row = {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    notifications_confirmed: boolean | null;
    notifications_confirmed_at: string | null;
    notifications_confirmed_by: string | null;
  };
  const rows = (data ?? []) as Row[];
  const nameById = new Map(rows.map((p) => [p.id, p.display_name || "Member"]));

  return rows.map((p) => ({
    id: p.id,
    name: p.display_name || "Member",
    avatarUrl: p.avatar_url,
    confirmed: !!p.notifications_confirmed,
    confirmedAt: p.notifications_confirmed_at,
    confirmedByName: p.notifications_confirmed_by ? nameById.get(p.notifications_confirmed_by) ?? null : null,
  }));
}

/** Check/uncheck "Notifications confirmed" for one member (migration 0157) —
 *  any app admin, not scoped to whoever sent the original test ping. */
export async function setNotificationTestConfirmed(
  userId: string,
  value: boolean,
): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("set_notification_test_confirmed", {
    p_user: userId,
    p_value: value,
  });
  return error ? { error: error.message } : {};
}
