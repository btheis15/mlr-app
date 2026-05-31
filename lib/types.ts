/**
 * Shared domain types for the Muskellunge Lake Resort app. Keep the resort data
 * shapes here (same split as Stock Game / Innjoy, which keep types in
 * lib/types.ts) so pages and components agree on the model.
 */

export type ActivityCategory = "On the water" | "On land" | "For kids" | "Evening";

/** Something to do at the resort. */
export interface Activity {
  id: string;
  name: string;
  emoji: string;
  category: ActivityCategory;
  /** Human-readable hours, e.g. "Daily · 8am–dusk". */
  hours: string;
  location: string;
  description: string;
  /** Display price, e.g. "$45 / half day" or "Free". */
  price: string;
}

/** A place to eat or grab something on property. */
export interface DiningSpot {
  id: string;
  name: string;
  emoji: string;
  hours: string;
  description: string;
}

/** A practical amenity / good-to-know. */
export interface Amenity {
  id: string;
  label: string;
  value: string;
  emoji: string;
}

/** Lightweight summary of one Family Fest schedule highlight, mirrored from the
 *  standalone family-fest app for the embedded hub. */
export interface FestHighlight {
  id: string;
  day: string; // ISO date
  start: string; // "HH:MM"
  title: string;
  emoji: string;
}

/** A push-style notice shown in the banner at the top of the app. Seeded in
 *  lib/data.ts today; the intent is for a Google-Drive-fed source to write these
 *  (e.g. "Dinner moved from 5 to 6") — see lib/announcements.ts for the seam. */
export interface Announcement {
  id: string;
  /** "alert" gets the loud treatment; "info" is a quiet notice. */
  severity: "info" | "alert";
  title: string;
  body?: string;
  /** ISO timestamp. */
  ts: string;
}

/** The signed-in guest. Identity is name + email for now (no verification yet);
 *  a one-time-code / magic-link step is the planned next layer. */
export interface User {
  name: string;
  email: string;
  /** Opt-in: email me when an admin pushes an alert. (Sending happens
   *  server-side once a mail provider is wired up.) */
  emailAlerts: boolean;
}

/** A single chat/comment message, tied to the author's identity. */
export interface ChatMessage {
  id: string;
  author: string;
  email: string;
  text: string;
  /** ISO timestamp. */
  ts: string;
}
