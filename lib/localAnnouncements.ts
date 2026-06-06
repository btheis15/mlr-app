/**
 * Admin-posted alerts, v1. When an admin pushes an alert from the app it's
 * stored here in localStorage and shown in the banner on this device. This is a
 * placeholder for the real flow:
 *
 *   admin posts → server validates they're an admin → writes the announcement →
 *   every client picks it up (poll/realtime) AND opted-in users get an email
 *   (and Android users a web push).
 *
 * Keeping the read/write here means the banner and composer don't change when
 * that backend lands — only these two functions do.
 */

import type { Announcement } from "./types";

export const LOCAL_ANNOUNCEMENTS_KEY = "mlr-local-announcements";

export function loadLocalAnnouncements(): Announcement[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_ANNOUNCEMENTS_KEY);
    const all = raw ? (JSON.parse(raw) as Announcement[]) : [];
    // Drop expired alerts so they don't linger in storage forever (default 6h,
    // see AdminAlertComposer). Rewrite if we pruned anything to keep it tidy.
    const now = Date.now();
    const live = all.filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now);
    if (live.length !== all.length) {
      localStorage.setItem(LOCAL_ANNOUNCEMENTS_KEY, JSON.stringify(live));
    }
    return live;
  } catch {
    return [];
  }
}

export function pushLocalAnnouncement(a: Announcement): void {
  const next = [a, ...loadLocalAnnouncements()];
  localStorage.setItem(LOCAL_ANNOUNCEMENTS_KEY, JSON.stringify(next));
  // Let the banner in this tab refresh immediately.
  window.dispatchEvent(new Event(LOCAL_ANNOUNCEMENTS_KEY));
}
