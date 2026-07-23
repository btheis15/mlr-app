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
  // Event targeting (migration 0096) — see lib/eventTargeting.ts. Set when an
  // admin links this alert to an event; AnnouncementBanner hides it from
  // anyone who explicitly RSVP'd "Can't make it" to that event.
  eventId?: string | null;
  excludeNotAttending?: boolean;
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
  | "committee_join_request"
  | "cabin_decision"
  | "cabin_message"
  | "post_tag"
  | "post_mention"
  | "post_reply"
  | "event_rsvp"
  | "help_request"
  | "help_response"
  | "work_item_created"
  | "house_stay_created"
  | "meeting_proposed"
  | "meeting_scheduled";

/** Every push category, on. Set when a member accepts the first-run push prompt
 *  (the backfill from migration 0034). New signups start with push OFF ('{}')
 *  until they accept the prompt. */
export const DEFAULT_PUSH_TYPES: PushType[] = [
  "alerts",
  "birthdays",
  "committee_join",
  "cabin_decision",
  "cabin_message",
  "post_tag",
  "post_mention",
  "post_reply",
  "chat",
  "help_request",
  "help_response",
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
  | "committee_join_request"
  | "cabin_request"
  | "cabin_decision"
  | "cabin_message"
  | "event_rsvp"
  | "help_request"
  | "help_response"
  | "help_urgent"
  | "work_item_comment"
  | "work_item_mention"
  | "work_item_created"
  | "house_stay_created"
  | "meeting_proposed"
  | "meeting_scheduled"
  | "signup_reminder"
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
  "committee_join_request",
  "cabin_request",
  "cabin_decision",
  "cabin_message",
  "event_rsvp",
  "help_request",
  "help_response",
  "help_urgent",
  "work_item_comment",
  "work_item_mention",
  "work_item_created",
  "house_stay_created",
  "meeting_proposed",
  "meeting_scheduled",
  "signup_reminder",
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
  /** Opt-in (default off): when at the resort, get an "Ask for Help" ping
   *  when another member nearby needs a hand. The real switch for receiving help
   *  requests — separate from notif_types/push_types, which only mute/route it.
   *  See migration 0037 + lib/helpRequests.ts. */
  willingToHelp: boolean;
  /** Profile photo URL (Supabase `avatars` bucket); null/absent = show initials. */
  avatarUrl?: string | null;
}

/** A house — a group members are designated into (e.g. "MJT House"). Each house
 *  gets its own private chat + its own scoped work items. A member belongs to at
 *  most one house; everyone is always "MLR" (resort-wide) by default. */
export interface House {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  position: number;
  rules: string; // shared, member-editable open-text "house rules" doc (0072)
}

/** One member's stay on a house calendar (migration 0071) — "I'm going up to
 *  the house on these dates, with these people." Everyone in the house sees who's
 *  staying and when; overlapping stays show who's up at the same time.
 *  `authorName`/`authorAvatarUrl` are joined from the creator's profile for
 *  display. Dates are ISO `YYYY-MM-DD`; `endDate` is inclusive (single-night ⇒
 *  end === start). */
export interface HouseStay {
  id: string;
  houseId: string;
  createdBy: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string | null;
  startDate: string;
  endDate: string;
  /** The added people coming along — free names, no account needed (spouse,
   *  kids, the dog, a friend). Head count = 1 (the member) + this list. */
  guestNames: string[];
  note: string | null;
  createdAt: string;
}

export type WorkItemStatus = "open" | "done";

/** How urgent a work item is — drives its chip + sort order (ASAP first).
 *  asap = needs doing right away · this_year = must happen this year ·
 *  nice_to_have = would be nice but isn't pressing. */
export type WorkItemUrgency = "asap" | "this_year" | "nice_to_have";

/** A photo/video attached to a work item (so people can see what a task is about). */
export interface WorkItemMedia {
  id: string;
  url: string;
  type: "image" | "video";
  position: number;
}

/** One item on the resort work checklist. Any signed-in member can add items;
 *  admins can edit, delete, and mark done. Items can also be attached to events
 *  (see event_work_items) so attendees know what's planned for a work weekend.
 *  `houseId` scopes an item: null = MLR / resort-wide (everyone sees it), a house
 *  id = visible only to that house's members. */
export interface WorkItem {
  id: string;
  title: string;
  notes: string | null;
  category: string | null;
  status: WorkItemStatus;
  peopleNeeded: number | null;
  urgency: WorkItemUrgency | null;
  houseId: string | null;
  media: WorkItemMedia[];
  commentCount: number;
  createdBy: string | null;
  // Who marked it done + when (migration 0088) — null while status is 'open'.
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A plain-text comment on a work item (with @mentions of members who can see
 *  the item). Author name/avatar are stitched in client-side for display. */
export interface WorkItemComment {
  id: string;
  workItemId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  mentions: string[];
  createdAt: string;
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
  /** E.164 phone, e.g. "+17155550112". Omitted until the chef links up. */
  phone?: string;
}

/** A single timed item on the week's agenda. */
export interface ScheduleEvent {
  id: string;
  /** ISO date, YYYY-MM-DD. */
  day: string;
  /** 24h time, "HH:MM". Omitted when the time isn't set yet — renders "TBD"
   *  for a day-locked event, or "No specific time" for an `anytime` one (see
   *  `formatEventTime` in lib/format.ts). */
  start?: string;
  end?: string;
  title: string;
  location: string;
  emoji: string;
  description: string;
  /** Who's running this event — point of contact, tap-to-call/text. */
  lead?: Chef;
  /** Set when the lead is linked to a real account (migration 0053) — lets
   *  the client tell "is the signed-in viewer this event's lead?" without a
   *  name-match. Null for a free-text lead (not in the app). */
  leadUserId?: string | null;
  /** Other members assigned to help run this event (migration 0110) — both
   *  the lead and anyone in this list can edit the event's details directly.
   *  Omitted (treat as empty) on the in-code seed. */
  crewUserIds?: string[];
  /** Optional "what to bring" note. */
  bring?: string;
  /** True ⇒ not locked to `day` — rendered in the "Anytime all week" group
   *  alongside activities (migration 0139). `day` still holds a value but the
   *  client ignores it for display/grouping. */
  anytime?: boolean;
  /** Optional cover photo (site-assets URL). */
  imageUrl?: string | null;
  /** Optional click-through link — a Google Doc/Sheet, sign-up form, or any
   *  web page for this event. `linkLabel` is the button text shown for it. */
  linkUrl?: string | null;
  linkLabel?: string | null;
  /** Limited sign-up time slots (e.g. "4 people per hour, noon–4pm") — see
   *  lib/scheduleSignups.ts for the slot list + capacity math. */
  signupEnabled?: boolean;
  signupCapacity?: number | null;
  signupSlotMinutes?: number | null;
  /** "HH:MM", first slot's start. */
  signupStartTime?: string | null;
  /** "HH:MM", the boundary the last slot must end by. */
  signupEndTime?: string | null;
  /** "interval" = derive slots from the start/end + minutes above (migration
   *  0135). "slots" = arbitrary, independent slots listed in `fest_schedule_slots`
   *  (migration 0136), each with its own day/time and no shared increment. */
  signupMode?: "interval" | "slots" | null;
  /** Free-text instructions the creator writes for people signing up. */
  signupInstructions?: string | null;
  /** Extra columns required on every person's sign-up row (e.g. "Character").
   *  The base name (linked account or typed) is always collected separately. */
  signupFields?: SignupField[] | null;
  /** Lead times (minutes before a slot) at which everyone signed up gets a
   *  reminder push (migration 0140), e.g. [120, 60, 15]. */
  signupReminderMinutes?: number[] | null;
}

/** One admin-defined extra column on a sign-up (migration 0136). `id` is a
 *  stable key the per-person values in the signups' `fields` map on. */
export interface SignupField {
  id: string;
  label: string;
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
  /** Who's running this activity — point of contact, tap-to-call/text
   *  (migration 0110, same shape as ScheduleEvent's lead). */
  lead?: Chef;
  leadUserId?: string | null;
  /** Other members assigned to help run this activity — both the lead and
   *  anyone in this list can edit the activity's details directly. Omitted
   *  (treat as empty) on the in-code seed. */
  crewUserIds?: string[];
  /** Sign-up slots for this activity (migration 0138) — same feature as a
   *  schedule event's (see lib/scheduleSignups.ts + ScheduleEvent's signup*). */
  signupEnabled?: boolean;
  signupCapacity?: number | null;
  signupSlotMinutes?: number | null;
  signupStartTime?: string | null;
  signupEndTime?: string | null;
  signupMode?: "interval" | "slots" | null;
  signupInstructions?: string | null;
  signupFields?: SignupField[] | null;
  signupReminderMinutes?: number[] | null;
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
  /** Set when the chef is linked to a real account (migration 0053) — lets
   *  the client tell "is the signed-in viewer this dinner's chef?" without a
   *  name-match. Null for a free-text chef (not in the app). */
  chefUserId: string | null;
  /** Other members assigned to help with this dinner (migration 0099) —
   *  distinct from `houses` below (which houses are teaming up, not who
   *  specifically). Both the chef and anyone in this list can edit the
   *  dinner's operational details (menu/served/prep) directly. */
  crewUserIds: string[];
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
  /** Omitted until the person makes an account and links up. */
  email?: string;
  /** E.164 phone, e.g. "+17155550201". Omitted until they link up. */
  phone?: string;
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
  /** Apple Cash handle — a phone or email tied to Apple Cash. */
  applecash?: string;
  /** PayPal username (paypal.me/<handle>) or email. */
  paypal?: string;
  /** Optional free-text note shown under the payee. */
  note?: string;
}

/** One Family Fest dues tier (Adult / Kid / per-day / without-food …). Amounts
 *  are admin-editable in the Planner and stored in `fest_dues`; a null amount
 *  renders "TBD". Mirrors the iOS `FestDuesTier`. */
export interface DuesTier {
  id: string;
  label: string;
  /** Whole dollars; null = TBD (not set yet). */
  amount: number | null;
  /** Optional qualifier, e.g. "per person", "covers meals". */
  note?: string;
  /** True for a per-day rate (e.g. "Adult (Per day)") — the Pay calculator
   *  multiplies it by a shared "how many days" count instead of treating it
   *  like a flat one-time/per-week amount. */
  perDay?: boolean;
}

/** Editable Family Fest meta (name, tagline, date window) — the `fest_config`
 *  row, mirrored from the iOS `FestConfig`. Read-with-fallback to FAMILY_FEST. */
export interface FestConfigContent {
  name: string;
  tagline: string;
  /** ISO date, YYYY-MM-DD. */
  startDate: string;
  endDate: string;
}

/* ── Cabin stays (lodging requests) ──────────────────────────────────────────
   "Request a Cabin Stay": members request a room in one of the resort's
   bookable places (an open-ended admin-managed roster — migration 0114) for a
   date range; admins, or that place's designated approver, approve/deny.
   Capacity is counted per place (room_count) — one room per request. Backed
   by Supabase (migration 0032). */

/** A bookable place. Capacity is just a room count for now; individual rooms
 *  can be named later without reworking this shape. `bedCount` and `notes` are
 *  admin-editable (migration 0089) so members can see sleeping capacity and any
 *  heads-up about current conditions (e.g. "water not hooked up yet"). `active`
 *  false takes the cabin out of the bookable list without deleting its history.
 *  `kind` (migration 0114) just labels what it is — a shared resort cabin vs.
 *  someone's private house — no behavior differs by kind. `approverUserId`
 *  null means "all app admins review this place's requests" (the original,
 *  unchanged default); set it to a specific member so a private house's owner
 *  — who may not be an app admin at all — can approve/deny their own place's
 *  requests without granting them anything else admin-shaped. */
export interface Cabin {
  id: string;
  slug: string;
  name: string;
  kind: "cabin" | "house";
  roomCount: number;
  bedCount: number | null;
  notes: string | null;
  active: boolean;
  sortOrder: number;
  approverUserId: string | null;
}

/** Rooms still bookable for the WHOLE requested range, per cabin. */
export interface CabinAvailability {
  cabinId: string;
  slug: string;
  name: string;
  roomCount: number;
  available: number;
  // Real bed counts, only for a cabin broken into named rooms (0092) —
  // null for a plain room-count cabin (migration 0111).
  bedsTotal: number | null;
  bedsAvailable: number | null;
}

/** A named room/area within a cabin (migration 0092) — e.g. "Upstairs South
 *  Room". Lets a cabin with fuzzy "N rooms" capacity instead offer specific,
 *  pickable spots (so people can tell if they'd be sharing a room), and lets
 *  one be marked temporarily closed (`active: false`) without deleting it. A
 *  cabin with no rooms defined keeps the old plain room-count booking flow. */
export interface CabinRoom {
  id: string;
  cabinId: string;
  name: string;
  beds: number;
  // Free-form admin note about this specific room (migration 0094), e.g.
  // "small room, no closet" — shown to members in the room picker.
  description: string | null;
  active: boolean;
  sortOrder: number;
}

/** A room's state for a specific date range — from cabin_room_availability(). */
export interface CabinRoomAvailability {
  roomId: string;
  name: string;
  beds: number;
  description: string | null;
  active: boolean;
  /** False if closed (`active` false) OR already approved-booked for an
   *  overlapping range. */
  available: boolean;
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
  // Set when an admin booked this on behalf of userId (migration 0087) —
  // null/undefined for a normal self-service request.
  bookedBy?: string | null;
  // Specific room(s) this booking reserves (migration 0092) — empty for a
  // cabin with no named rooms, or a legacy booking made before they existed.
  rooms: { id: string; name: string }[];
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
  /** Optional "HH:MM" (24h, local resort time) — when set, reminder offsets
   *  (see lib/scheduledBroadcasts.ts) can be hour-based ("2 hours before");
   *  otherwise only day-based offsets are offered. */
  startTime?: string | null;
  /** Multi-day events can offer a per-day RSVP drill-down (Family Fest). */
  dayRsvp: boolean;
  /** "admin" = a native event (seed or DB row); "gcal" = a future Google-Calendar
   *  feed (the deferred seam in lib/events.ts); "meeting" = created by finalizing
   *  a meeting poll (see lib/meetings.ts finalizeMeetingAsEvent). */
  source: "admin" | "gcal" | "meeting";
  /** True when this is a real, editable DB row (vs a synthesized seed event). */
  persisted: boolean;
}

export type AttendanceStatus = "going" | "maybe" | "not_going";

/** One member's RSVP to one event. `days` is an optional per-day map for multi-day
 *  events with the drill-down on (keys are ISO dates). `name`/`avatarUrl` are
 *  joined from the member's profile when the roster loads. `confirmed` is false
 *  only for a status carried over from a meeting poll's winning slot (see
 *  finalize_meeting_as_event) until the member re-taps their own RSVP. */
export interface EventAttendance {
  eventId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: AttendanceStatus;
  days?: Record<string, AttendanceStatus> | null;
  confirmed: boolean;
}

/** An event's roster, grouped by (effective) status, plus counts. */
export interface AttendanceSummary {
  going: EventAttendance[];
  maybe: EventAttendance[];
  notGoing: EventAttendance[];
  counts: { going: number; maybe: number; notGoing: number };
}

/* ── Ask for Help ────────────────────────────────────────────────────────────
   A member at the resort posts a short request; willing members who are also at
   the resort right now get notified, can respond, and see open requests in a
   shared log. "At the resort" is derived from event attendance (±2 days) /
   approved cabin stays — no geolocation. Backed by Supabase (migration 0037).
   See lib/helpRequests.ts for the presence math + RPC wrappers. */

export type HelpRequestStatus = "open" | "resolved" | "cancelled";

/** A "who's on the way" entry on a help request — the only response is committing
 *  to come help. `name`/`avatarUrl` are joined from the responder's profile when
 *  the log loads. */
export interface HelpResponse {
  userId: string;
  name: string;
  avatarUrl: string | null;
  note: string | null;
  createdAt: string;
}

/** A single line on a request's "what to bring" checklist (migration 0046).
 *  `claimedBy` is the helper bringing it (null = still up for grabs); the name is
 *  joined from their profile when the log loads. */
export interface BringItem {
  id: string;
  label: string;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
}

/** One help request in the shared log. `responses` is filled in when the log
 *  loads (joined from help_responses). `lat`/`lng` are present only if the
 *  requester chose to share their precise location. */
export interface HelpRequest {
  id: string;
  userId: string;
  /** Requester's display name + avatar, joined for the log. */
  name: string;
  avatarUrl: string | null;
  description: string;
  category: string | null;
  whereText: string | null;
  lat: number | null;
  lng: number | null;
  /** ISO timestamp — when help is needed (defaults to submit time). */
  neededAt: string;
  /** How many people the requester needs (≥1). Once this many are on the way the
   *  request reads as fulfilled and everyone eligible is told. */
  neededCount: number;
  status: HelpRequestStatus;
  /** Set once `neededCount` people are on the way (null until then). */
  fulfilledAt: string | null;
  /** How many willing + present members it was sent to (stamped at submit). */
  notifiedCount: number;
  createdAt: string;
  /** ISO timestamp; past it the request reads as "expired" in the log. */
  expiresAt: string | null;
  responses: HelpResponse[];
  /** Optional "what to bring" checklist (empty if the requester listed nothing).
   *  Joined from help_request_items when the log loads. */
  items: BringItem[];
}
