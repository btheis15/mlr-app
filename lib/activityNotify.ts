// Notify people about a Family Fest activity or a change to one — reusing the
// existing "reach everyone" primitives (lib/broadcast.ts) so there's no new
// backend. Every activity/dinner on the Family Fest tab is implicitly part of
// Family Fest 2026, so a notification targets that event and EXCLUDES anyone who
// RSVP'd "not going" (people who haven't RSVP'd still get it — they might come).
//
// Channels mirror the admin composer: a top-of-app Banner (which also rides a
// phone push for anyone with alert pushes on), a durable Activity-tab entry, and
// Email to opted-in members. A "minor change" send can be Email-only (no push).
//
// Sending is admin-only server-side (send_broadcast_notification / the
// announcements insert both check is_admin), so callers gate the UI to admins.

import { postAnnouncement, sendActivityNotification } from "@/lib/broadcast";
import { formatTime, formatDate } from "@/lib/format";
import type { ScheduleEvent } from "@/lib/types";

/** The stable event id all Family Fest tab content targets (a seed slug, not a
 *  DB row — see RESORT_EVENTS in lib/data.ts / CLAUDE.md "Resort events"). */
export const FAMILY_FEST_EVENT_ID = "family-fest-2026";

export interface ActivityNotifyChannels {
  /** Top-of-app banner (also pushes to phones with alert pushes on). */
  banner: boolean;
  /** Durable entry in everyone's Activity/bell tab. */
  activity: boolean;
  /** Email opted-in members. */
  email: boolean;
}

export interface SendActivityNotifyInput {
  title: string;
  body?: string | null;
  channels: ActivityNotifyChannels;
  /** The activity's schedule-item id — the notification taps through to it. */
  scheduleItemId?: string | null;
  /** Banner lifetime (hours). Default 3 — an event-time-change notice is only
   *  useful for a few hours, so it shouldn't still be sitting in the banner
   *  the next day. */
  expiryHours?: number;
}

/**
 * Send a Family-Fest-targeted notification across the chosen channels. Targets
 * `family-fest-2026` with exclude-not-attending on, so it reaches everyone except
 * people who said they're not coming. Returns the first error, if any.
 */
export async function sendActivityNotify(input: SendActivityNotifyInput): Promise<{ error?: string }> {
  const title = input.title.trim();
  if (!title) return { error: "A message is required." };
  if (!input.channels.banner && !input.channels.activity && !input.channels.email) {
    return { error: "Pick at least one way to send it." };
  }
  const url = input.scheduleItemId ? `/family-fest/schedule/${input.scheduleItemId}` : "/family-fest";
  const errors: string[] = [];

  // Activity-tab entry (also the in-app feed row).
  if (input.channels.activity) {
    const { error } = await sendActivityNotification({
      title,
      body: input.body ?? null,
      url,
      audience: "everyone",
      eventId: FAMILY_FEST_EVENT_ID,
      excludeNotAttending: true,
    });
    if (error) errors.push(error);
  }

  // Banner and/or email share the one announcements row. show_banner=false with
  // email on = email-only (no banner, no push).
  if (input.channels.banner || input.channels.email) {
    const { error } = await postAnnouncement({
      title,
      body: input.body ?? null,
      showBanner: input.channels.banner,
      notifyEmail: input.channels.email,
      emailAudience: "all",
      expiryHours: input.expiryHours ?? 3,
      eventId: FAMILY_FEST_EVENT_ID,
      excludeNotAttending: true,
    });
    if (error) errors.push(error);
  }

  return errors.length ? { error: errors.join("; ") } : {};
}

/**
 * A sensible prefilled message for a change to an activity — so the sender barely
 * has to type. If a (new) time is given, defaults to "{title} is now at {time}";
 * otherwise a plain "Update: {title}". The sender can edit it before sending.
 */
export function changeMessageDefault(title: string, time?: string | null): string {
  const clean = title.trim() || "the activity";
  const t = time ? formatTime(time) : null;
  return t ? `${clean} is now at ${t}` : `Update: ${clean}`;
}

/**
 * Prefill a reminder/alert from an activity — title + a when/where summary + the
 * tap-through url — so an admin linking an activity in the broadcast composer
 * barely has to type. Pulls straight from the schedule item's own fields.
 */
export function activityReminderDefaults(a: ScheduleEvent): { title: string; body: string; url: string } {
  const title = `${a.emoji ?? ""} ${a.title}`.trim();
  const when = a.anytime
    ? "Anytime all week"
    : [a.day ? formatDate(a.day) : null, a.start ? formatTime(a.start) : null].filter(Boolean).join(" · ");
  const body = [when || null, a.location ? `📍 ${a.location}` : null].filter(Boolean).join("  ·  ");
  return { title, body, url: `/family-fest/schedule/${a.id}` };
}
