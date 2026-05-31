/**
 * Announcements — the notices shown in the banner at the top of the app
 * (e.g. "Dinner moved from 5 to 6 tonight").
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE GOOGLE DRIVE SEAM
 * ───────────────────────────────────────────────────────────────────────────
 * Today these are static seed data. The intent is for the resort to keep a
 * Google Drive file (Sheet/Doc) of announcements, and for a change to that file
 * to surface here automatically. When that's wired up, this is the only place
 * that changes:
 *
 *   1. Add a server route (e.g. app/api/announcements/route.ts) that reads the
 *      Drive file via the Drive API (service account) or a published CSV/JSON
 *      export URL, maps rows → Announcement[], and is revalidated on a short
 *      interval or via a Drive push webhook.
 *   2. Make getAnnouncements() fetch that route instead of returning ANNOUNCEMENTS.
 *
 * The Announcement shape and the banner UI stay exactly the same, so the rest
 * of the app doesn't change.
 */

import type { Announcement } from "./types";

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "welcome",
    severity: "info",
    title: "Welcome to the new resort app 🌲",
    body: "Browse activities, dining, amenities, and what's on for Family Fest. Sign-in, chat, and push alerts are coming soon.",
    ts: "2026-05-31T09:00:00Z",
  },
];

/**
 * Returns active announcements, newest first. Async on purpose so swapping in a
 * Drive-backed fetch later doesn't change any call sites.
 */
export async function getAnnouncements(): Promise<Announcement[]> {
  return [...ANNOUNCEMENTS].sort((a, b) => b.ts.localeCompare(a.ts));
}
