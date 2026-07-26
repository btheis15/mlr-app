// Shared client seam for the two underlying "reach everyone" primitives —
// posting a top-of-app banner (+ optional email) and sending a per-recipient
// Activity-tab notification. Both AdminBroadcastComposer (Admin → Alerts &
// Notifications, the merged "Post an alert" / "Send a notification" form)
// and AdminCallouts (a Home callout's one-time "Also send a notification" /
// "Also send an email" side actions) call these instead of duplicating the
// insert/RPC logic, so the two surfaces can't drift out of sync.
//
// Banner and Email are independent flags on the same `announcements` row
// (migration 0126's `show_banner` decouples them — an email-only send inserts
// a row with show_banner:false so the mailer/push-sender still see it without
// it ever painting the top-of-app banner). Activity feed is untouched — still
// send_broadcast_notification (migration 0030/0096).

import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/roles";

export interface PostAnnouncementInput {
  title: string;
  body?: string | null;
  /** Show it in everyone's top-of-app banner. */
  showBanner: boolean;
  /** Also email opted-in members (or just admins, via emailAudience). */
  notifyEmail: boolean;
  emailAudience: "all" | "admins";
  /** How long the banner stays up (irrelevant when showBanner is false, but
   *  still stamped — `expires_at` has a not-null-ish server default anyway). */
  expiryHours: number;
  eventId?: string | null;
  excludeNotAttending?: boolean;
}

/** Insert a banner/email `announcements` row. Degrades gracefully on older,
 *  not-yet-migrated schemas (missing show_banner / event columns) by retrying
 *  without them, rather than failing the whole send outright. */
export async function postAnnouncement(input: PostAnnouncementInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const uid = await getCurrentUserId();
  const expiresAt = new Date(Date.now() + input.expiryHours * 60 * 60 * 1000).toISOString();
  const base = {
    author_id: uid,
    title: input.title.trim(),
    body: input.body?.trim() || null,
    severity: "alert",
    notify_email: input.notifyEmail,
    expires_at: expiresAt,
  };
  const withBanner = { ...base, show_banner: input.showBanner };
  const targeted = {
    ...withBanner,
    email_audience: input.emailAudience,
    event_id: input.eventId ?? null,
    exclude_not_attending: input.excludeNotAttending ?? true,
  };
  let { error } = await sb.from("announcements").insert(targeted);
  if (error && /email_audience|event_id|exclude_not_attending/i.test(error.message || "")) {
    // Pre-0017/0096 those columns don't exist yet.
    ({ error } = await sb.from("announcements").insert(withBanner));
  }
  if (error && /show_banner/i.test(error.message || "")) {
    // Pre-0126: no way to suppress the banner yet — post with it showing
    // rather than fail outright (matches the only behavior that existed
    // before this migration).
    ({ error } = await sb.from("announcements").insert(base));
  }
  return error ? { error: error.message } : {};
}

export interface SendActivityNotificationInput {
  title: string;
  body?: string | null;
  url?: string | null;
  audience: "everyone" | "admins";
  expiresAt?: string | null;
  eventId?: string | null;
  excludeNotAttending?: boolean;
}

/** Call send_broadcast_notification — one row per recipient in their Activity
 *  tab. Returns the number of recipients on success. */
export async function sendActivityNotification(
  input: SendActivityNotificationInput,
): Promise<{ count?: number; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  let { data, error } = await sb.rpc("send_broadcast_notification", {
    p_title: input.title.trim(),
    p_body: input.body?.trim() || null,
    p_url: input.url?.trim() || null,
    p_audience: input.audience,
    p_expires_at: input.expiresAt ?? null,
    p_event_id: input.eventId ?? null,
    p_exclude_not_attending: input.excludeNotAttending ?? false,
  });
  if (error && /p_event_id|p_exclude_not_attending/i.test(error.message || "")) {
    // Pre-0096: the RPC doesn't take these params yet.
    ({ data, error } = await sb.rpc("send_broadcast_notification", {
      p_title: input.title.trim(),
      p_body: input.body?.trim() || null,
      p_url: input.url?.trim() || null,
      p_audience: input.audience,
      p_expires_at: input.expiresAt ?? null,
    }));
  }
  if (error) return { error: error.message };
  return { count: typeof data === "number" ? data : 0 };
}
