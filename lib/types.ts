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

/* ── Family Fest section types ───────────────────────────────────────────────
   The Family Fest experience lives inside this app at /family-fest/*. These
   shapes back its schedule, dinners, crew/RSVP, photos, pay, and anytime
   activities. Client-only seed data for now (lib/data.ts). */

export type RsvpStatus = "yes" | "maybe" | "no";

/** Whoever's running an event or dinner — rendered as tap-to-call / tap-to-text
 *  links (tel:/sms:) that work on iOS and Android. */
export interface Chef {
  name: string;
  /** E.164 phone, e.g. "+17155550112". */
  phone: string;
}

/** A single timed item on the week's agenda. */
export interface ScheduleEvent {
  id: string;
  /** ISO date, YYYY-MM-DD. */
  day: string;
  /** 24h time, "HH:MM". */
  start: string;
  end?: string;
  title: string;
  location: string;
  emoji: string;
  description: string;
  /** Who's running this event — point of contact, tap-to-call/text. */
  lead?: Chef;
  /** Optional "what to bring" note. */
  bring?: string;
}

/** A "thing to do" that runs all week with no set time — e.g. the scavenger
 *  hunt. Distinct from a ScheduleEvent (which has a time/slot). */
export interface FestActivity {
  id: string;
  title: string;
  emoji: string;
  /** One-liner for the list. */
  blurb: string;
  /** Optional how-it-works detail. */
  details?: string;
  /** Optional where to start / pick up materials. */
  location?: string;
}

/** A household coming (or not) to the fest. */
export interface CrewMember {
  id: string;
  /** Household / family name, e.g. "The Petersons". */
  name: string;
  headcount: number;
  status: RsvpStatus;
  /** Potluck assignment — what they're bringing. */
  bringing?: string;
}

/** A tile in the shared album. Placeholder art uses a gradient + emoji. */
export interface Memory {
  id: string;
  caption: string;
  /** Tailwind gradient utility classes for the placeholder tile. */
  gradient: string;
  emoji: string;
}

/** One night's dinner: the head chef of the day, the houses on crew, what's
 *  being made, and when/where to gather (+ prep). */
export interface Dinner {
  id: string;
  day: string;
  title: string;
  emoji: string;
  /** The "head chef of the day" — point of contact, tap-to-call/text. */
  chef: Chef;
  /** The 2–3 houses (families) teaming up to cook this night. */
  houses: string[];
  /** What's on the menu. */
  menu: string;
  /** When dinner is served, e.g. "6:00 PM". */
  time: string;
  /** Where dinner is served. */
  location: string;
  /** When the crew meets to start prepping (click-through detail). */
  prepTime: string;
  /** Where the crew meets to prep, if different from where it's served. */
  prepLocation?: string;
}

/** Someone to pay for the fest (organizer, food lead, …) via Venmo/Zelle. */
export interface Payee {
  id: string;
  name: string;
  role: string;
  /** Venmo username without the leading @. */
  venmo?: string;
  /** Zelle handle — an email or phone registered with Zelle. */
  zelle?: string;
}
