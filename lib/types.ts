/**
 * Shared domain types for the Muskellunge Lake Resort app. Keep the resort data
 * shapes here (same split as Stock Game / Innjoy, which keep types in
 * lib/types.ts) so pages and components agree on the model.
 */

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
  /**
   * ISO timestamp. Once past, the notice auto-hides from the banner (so admin
   * alerts don't sit at the top forever). Admin-posted alerts default to 6h;
   * the composer can stretch it up to 30 days. Undefined = never auto-expires
   * (e.g. the seed welcome notice).
   */
  expiresAt?: string;
}

/** The signed-in guest. Identity is name + email for now (no verification yet);
 *  a one-time-code / magic-link step is the planned next layer. */
/** A push-notification category a member can opt into (multi-select; migration
 *  0020). Any subset is allowed; an empty set means no push. */
export type PushType = "chat" | "mentions" | "alerts" | "birthdays";

export interface User {
  name: string;
  email: string;
  /** Opt-in: email me when an admin pushes an alert. (Sending happens
   *  server-side once a mail provider is wired up.) */
  emailAlerts: boolean;
  /** Which categories trigger a push on this account (multi-select). The actual
   *  per-device subscription lives in `push_subscriptions`; this is what the
   *  mini's push-sender filters on. Empty = no push. */
  pushTypes: PushType[];
  /** TESTING ONLY, gated to specific accounts (the mini's PUSH_SELF_NOTIFY_USER_IDS):
   *  also notify me of my OWN actions so push can be tested without a second
   *  person. Has no effect for accounts not on that list. */
  pushSelfNotify: boolean;
  /** Admin-only (default on): push me when a new member joins. Only honored for
   *  admins (the mini's push-sender notifies admins); harmless on other accounts. */
  notifyNewMembers: boolean;
  /** Profile photo URL (Supabase `avatars` bucket); null/absent = show initials. */
  avatarUrl?: string | null;
}

/** A post in the shared feed — a photo and/or a note, by a member. (Combines
 *  the old chat + photos.) Runtime posts add a real image; seed posts use a
 *  gradient tile so the feed looks alive without shipping image binaries. */
export interface Post {
  id: string;
  author: string;
  /** ISO timestamp. */
  ts: string;
  text?: string;
  /** Seed-only placeholder image: Tailwind gradient classes + an emoji. */
  gradient?: string;
  emoji?: string;
  /** Seed baseline like count (so the feed looks alive). */
  likes?: number;
}

/* ── Family Fest section types ───────────────────────────────────────────────
   The Family Fest experience lives inside this app at /family-fest/*. These
   shapes back its schedule, dinners, crew/RSVP, photos, pay, and anytime
   activities. Client-only seed data for now (lib/data.ts). */

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

/** A member of a resort committee — contactable by email / call / text. */
export interface CommitteeMember {
  name: string;
  /** e.g. "Lead". Omitted for regular members. */
  role?: string;
  /** Areas this person owns, e.g. ["Meals", "Scavenger Hunt"]. Used on the
   *  busier committees (Family Fest) where people wear several hats. */
  roles?: string[];
  email: string;
  /** E.164 phone, e.g. "+17155550201". */
  phone: string;
}

/** A volunteer committee that helps run the resort year-round. */
export interface Committee {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  members: CommitteeMember[];
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

/* ── Cabin stays (lodging requests) ──────────────────────────────────────────
   "Request a Cabin Stay": members request a room in one of the resort's two
   houses for a date range; admins approve/deny. Capacity is counted per house
   (room_count) — one room per request. Backed by Supabase (migration 0032). */

/** A bookable house. Capacity is just a room count for now; individual rooms
 *  can be named later without reworking this shape. */
export interface Cabin {
  id: string;
  slug: string;
  name: string;
  roomCount: number;
  sortOrder: number;
}

/** Rooms still bookable for the WHOLE requested range, per cabin. */
export interface CabinAvailability {
  cabinId: string;
  slug: string;
  name: string;
  roomCount: number;
  available: number;
}

export type CabinBookingStatus = "pending" | "approved" | "denied" | "cancelled";

/** One stay request. `checkOut` is the departure date (exclusive): a stay
 *  occupies the nights [checkIn, checkOut). `userId`/`cabinName` are filled in
 *  for the admin queue. */
export interface CabinBooking {
  id: string;
  cabinId: string;
  cabinName?: string;
  userId?: string;
  checkIn: string; // ISO date YYYY-MM-DD
  checkOut: string; // ISO date YYYY-MM-DD (departure, exclusive)
  guests: number;
  notes: string | null;
  status: CabinBookingStatus;
  reviewNote: string | null;
  createdAt: string;
}
