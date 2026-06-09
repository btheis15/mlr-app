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
 *  0020, unified in 0034). Any subset is allowed; an empty set means no push.
 *  Three categories ride their own senders (chat firehose, broadcast alerts,
 *  the daily birthdays job); the other five mirror an in-app `notifications`
 *  row of the matching type (see the mini's push-sender). */
export type PushType =
  | "chat"
  | "alerts"
  | "birthdays"
  | "committee_join"
  | "cabin_decision"
  | "post_tag"
  | "post_mention"
  | "post_reply";

/** Every push category, on. Set when a member accepts the first-run push prompt
 *  (the backfill from migration 0034). New signups start with push OFF ('{}')
 *  until they accept the prompt. */
export const DEFAULT_PUSH_TYPES: PushType[] = [
  "alerts",
  "birthdays",
  "committee_join",
  "cabin_decision",
  "post_tag",
  "post_mention",
  "post_reply",
  "chat",
];

/** A kind of in-app notification shown in the Notifications tab (migration
 *  0030). Each kind is fanned out by a DB trigger on its source event; members
 *  choose which kinds they receive via `notif_types` (migration 0029) — all
 *  EXCEPT `broadcast`, which an admin sends deliberately and always delivers. */
export type NotifType =
  | "post_comment"
  | "post_reply"
  | "post_mention"
  | "post_tag"
  | "post_reaction"
  | "new_post"
  | "chat_mention"
  | "committee_join"
  | "cabin_request"
  | "cabin_decision"
  | "broadcast";

/** The member-selectable notification kinds (everything but `broadcast`), so
 *  the settings UI and the User.notifTypes preference stay in sync. */
export type NotifPrefType = Exclude<NotifType, "broadcast">;

/** Default = all member-selectable kinds on. Mirrors the DB column default in
 *  migration 0029; used as the client fallback before the row loads / if the
 *  migration hasn't run yet. */
export const DEFAULT_NOTIF_TYPES: NotifPrefType[] = [
  "post_comment",
  "post_reply",
  "post_mention",
  "post_tag",
  "post_reaction",
  "new_post",
  "chat_mention",
  "committee_join",
  "cabin_request",
  "cabin_decision",
];

/** One row in a member's Notifications feed. The `title`/`body` are denormalized
 *  at write time (e.g. "Jane commented on your post"); `actorName`/`actorAvatarUrl`
 *  are joined from the actor's profile when the feed loads. */
export interface AppNotification {
  id: string;
  type: NotifType;
  actorId: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  title: string;
  body: string | null;
  /** In-app deep-link target, e.g. "/posts?post=…" or "/committees/slug/chat?m=…". */
  url: string | null;
  /** ISO timestamps. */
  createdAt: string;
  /** When the member last opened the tab after this arrived (drives the badge). */
  seenAt: string | null;
  /** When the member tapped this item (drives bold/unread styling). */
  readAt: string | null;
  /** Optional: past this, the item stays in the list but stops counting toward
   *  the badge (mainly admin broadcasts). */
  expiresAt: string | null;
}

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
  /** Which in-app notification kinds land in this member's Notifications tab
   *  (migration 0029). Never includes "broadcast" — admin broadcasts always
   *  deliver regardless of this list. */
  notifTypes: NotifPrefType[];
  /** Whether this member has already seen the one-time first-run push prompt
   *  (migration 0034). False = show "Turn on notifications?" the next time they
   *  open the app; set true once they accept or dismiss it. */
  pushPrompted: boolean;
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

/* ── Resort events & attendance ──────────────────────────────────────────────
   The resort calendar (Family Fest, Work Weekends, holiday weekends like the 4th
   of July, and custom admin events) + a Facebook-style Going / Maybe / Can't-make
   RSVP per member. Events are admin-managed in Supabase (migration 0034); Family
   Fest is synthesized from FAMILY_FEST (lib/data.ts) so its dates stay tied to the
   season model. Attendance (migration 0035) keys on a stable string event id, with
   an optional per-day breakdown for multi-day events. See lib/events.ts. */

export type EventKind = "family_fest" | "work_weekend" | "holiday" | "custom";

/** One event on the resort calendar. `id` is a STABLE string — the DB uuid for
 *  admin-created events, or a slug for synthesized seed events (e.g.
 *  "family-fest-2026"). Single-day events have `endDate` null/absent. */
export interface ResortEvent {
  id: string;
  /** Stable slug for the seed↔DB merge (e.g. "family-fest-2026"). */
  slug?: string;
  kind: EventKind;
  title: string;
  emoji?: string;
  description?: string;
  location?: string;
  /** ISO "YYYY-MM-DD". */
  startDate: string;
  /** ISO "YYYY-MM-DD"; null/absent ⇒ single-day. */
  endDate?: string | null;
  /** Multi-day events can offer a per-day RSVP drill-down (Family Fest). */
  dayRsvp: boolean;
  /** "admin" = a native event (seed or DB row); "gcal" = a future Google-Calendar
   *  feed (the deferred seam in lib/events.ts). */
  source: "admin" | "gcal";
  /** True when this is a real, editable DB row (vs a synthesized seed event). */
  persisted: boolean;
}

export type AttendanceStatus = "going" | "maybe" | "not_going";

/** One member's RSVP to one event. `days` is an optional per-day map for multi-day
 *  events with the drill-down on (keys are ISO dates). `name`/`avatarUrl` are
 *  joined from the member's profile when the roster loads. */
export interface EventAttendance {
  eventId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: AttendanceStatus;
  days?: Record<string, AttendanceStatus> | null;
}

/** An event's roster, grouped by (effective) status, plus counts. */
export interface AttendanceSummary {
  going: EventAttendance[];
  maybe: EventAttendance[];
  notGoing: EventAttendance[];
  counts: { going: number; maybe: number; notGoing: number };
}
