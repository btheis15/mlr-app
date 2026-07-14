/**
 * Seed data for the Muskellunge Lake Resort app. Client-only for now (no
 * backend), so resort info and the embedded Family Fest
 * highlights live here as static data. Runtime/user data (identity, chat) is
 * layered on via localStorage in the client views. Announcements have their own
 * module (lib/announcements.ts) because that's the seam a Google-Drive feed
 * plugs into.
 */

import type {
  Committee,
  Dinner,
  FestActivity,
  FestHighlight,
  Payee,
  Post,
  ResortEvent,
  ScheduleEvent,
} from "./types";

/** Seed posts for the shared feed (photos + notes). Placeholder content so the
 *  feed looks alive; real posts are device-local until the backend lands. */
export const POSTS: Post[] = [
  { id: "p1", author: "Aunt Linda", ts: "2026-05-31T23:10:00Z", text: "Counting down — can't wait to see everyone Up North! 🥳", likes: 4 },
  { id: "p2", author: "Grandpa", ts: "2026-05-31T20:00:00Z", text: "First musky of the season 🎣", gradient: "from-teal-300 to-cyan-500", emoji: "🎣", likes: 9 },
  { id: "p3", author: "Cousin Sam", ts: "2026-05-30T18:30:00Z", text: "Sunset off the main dock 🌅", gradient: "from-amber-300 to-rose-400", emoji: "🌅", likes: 6 },
  { id: "p4", author: "The Petersons", ts: "2026-05-29T15:00:00Z", text: "Who's bringing the cornhole boards this year?", likes: 2 },
];

/**
 * Resort committees — year-round volunteer groups.
 *
 * Family Fest's roster is the **real** committee: each person's `roles[]` are
 * the areas they own within the one Family Fest committee (Meals, Entertainment
 * & Games, etc. — these are roles, not separate committees). This static seed
 * carries **names + roles only** — no `email`/`phone` — because it ships in the
 * public client JS bundle; contact info now lives server-side in the Supabase
 * `committee_roster` table (migrations 0056/0060, admin-edited via
 * `AdminCommittees`), which is the real roster nowadays and is what
 * `CommitteeRoster`/`nameMatches()` (lib/committees.ts) resolve each slot
 * against for account linking + contact display. This list is just the
 * display fallback (names/areas) for people who haven't linked an account yet.
 *
 * Resort Maintenance + Beautification have **no roster yet** — their old
 * illustrative placeholders were cleared. Add real people as they sign on.
 */
/** The Family Fest committee's role areas, in display order. Each person's
 *  `roles[]` are drawn from these (a trailing " · Lead" marks the area's lead).
 *  Used to lay the roster out grouped by area on the committee page. */
export const FAMILY_FEST_AREAS = [
  "Meals",
  "Entertainment & Games",
  "Art & Decorating",
  "Merchandise, Fundraising & Polling",
  "Logistics, Scheduling & Finance",
] as const;

export const COMMITTEES: Committee[] = [
  {
    slug: "resort-maintenance",
    name: "Resort Maintenance",
    emoji: "🛠️",
    description: "Cabin upkeep, docks, mowing, and getting the grounds ready each season.",
    members: [],
  },
  {
    slug: "family-fest",
    name: "Family Fest",
    emoji: "🎉",
    description:
      "The big one — plans the whole week. Each person owns one or more areas (meals, entertainment & games, art & decorating, merchandise/fundraising/polling, logistics & finance); each area has a Lead.",
    // No `email`/`phone` here on purpose — this list ships in the public
    // client JS bundle. The stable identity key that LINKS a roster slot to a
    // real account (matched against `profiles.contact_email`, which Supabase
    // seeds from each person's login email on signup) now lives server-side in
    // the `committee_roster` table (migrations 0056/0060), not in this seed.
    // See lib/committees.ts + components/CommitteeRoster.tsx.
    members: [
      { name: "Lauren Zerfas", roles: ["Meals · Lead"] },
      { name: "Jessica Stewart", roles: ["Meals", "Merchandise, Fundraising & Polling", "Logistics, Scheduling & Finance"] },
      { name: "Rob Hermanson", roles: ["Meals", "Logistics, Scheduling & Finance"] },
      { name: "Lisa Gorge", roles: ["Meals"] },
      { name: "Matthew Vinezeano", roles: ["Meals", "Entertainment & Games"] },
      { name: "Kity Theis", roles: ["Meals", "Logistics, Scheduling & Finance"] },
      { name: "Natalie Theis de Pareja", roles: ["Meals", "Entertainment & Games"] },
      { name: "Keith Thibodeau", roles: ["Entertainment & Games · Lead"] },
      { name: "Rick Gorge", roles: ["Entertainment & Games", "Merchandise, Fundraising & Polling · Lead"] },
      { name: "Markus Hofer", roles: ["Entertainment & Games"] },
      { name: "Karen Theis", roles: ["Entertainment & Games"] },
      { name: "Zack Kauranen", roles: ["Entertainment & Games"] },
      { name: "Abbie Theis", roles: ["Entertainment & Games", "Art & Decorating", "Merchandise, Fundraising & Polling"] },
      { name: "Brian Theis", roles: ["Entertainment & Games", "Merchandise, Fundraising & Polling", "Logistics, Scheduling & Finance"] },
      { name: "Jenny Snively", roles: ["Art & Decorating · Lead"] },
      { name: "Christy Gorge", roles: ["Art & Decorating"] },
      { name: "Lindsay Thibodeau", roles: ["Art & Decorating"] },
      { name: "Ellie", roles: ["Art & Decorating"] },
      { name: "Michelle Birkholz", roles: ["Art & Decorating"] },
      { name: "Cathy Hofer", roles: ["Logistics, Scheduling & Finance · Lead"] },
      { name: "Cassie Paparigian", roles: ["Logistics, Scheduling & Finance"] },
    ],
  },
  {
    slug: "beautification",
    name: "Beautification",
    emoji: "🌲",
    description: "Planting, flower beds, trails, and keeping the resort looking its best.",
    members: [],
  },
];

// Admin is determined solely by `profiles.is_admin` in Supabase — the database
// is the single source of truth (see IdentityProvider). The first admin is
// bootstrapped once from the SQL editor; after that admins promote each other
// in-app via the gated `set_admin()` function. There is intentionally no client
// allow-list: it could only ever grant UI access the server doesn't honor,
// which just produces "the app shows me admin tools but they don't work".

export const RESORT = {
  name: "Muskellunge Lake Resort",
  shortName: "MLR",
  tagline: "Your Northwoods home on Muskellunge Lake.",
  /** Heritage. The resort has been in the Theis family since **1959** (when it
      was purchased) — that's the line Home leads with. **1987** is when **Family
      Fest** began (and what the logo reads), so it's the Family-Fest-page callout. */
  familySince: "1959",
  est: "1987",
  founders: "Leo & Dorothy Theis",
  heritageTagline: "Fishing · Hunting · Boating",
  heritageNote:
    "The original light-housekeeping cabins on Muskellunge Lake — five miles out of Tomahawk on Highway 8.",
  town: "Tomahawk, Wisconsin",
  address: "Muskellunge Lake · 5 mi from Tomahawk on Hwy 8 · Tomahawk, WI",
  phone: "+17155550100",
  frontDesk: "Lodge front desk · 7am–9pm",
  checkIn: "4:00 PM",
  checkOut: "11:00 AM",
  wifiNetwork: "MLR-Guest",
  wifiPassword: "musky2026",
} as const;

/** The Family Fest event. Family Fest is now a built-in section of this app
 *  (app/family-fest/*) rather than a separate app — this is its meta + the
 *  season window; the schedule, dinners, crew, etc. are the exports below. */
export const FAMILY_FEST = {
  name: "Family Fest 2026",
  shortName: "Family Fest",
  tagline: "One week. The whole clan. The lake.",
  /** 2026 theme — official title, Renaissance / fantasy flavored. */
  theme: "Ye Olde Family Feste",
  startDate: "2026-07-26",
  endDate: "2026-08-01",
  location: "Muskellunge Lake Resort",
  address: "Muskellunge Lake · 5 mi from Tomahawk on Hwy 8 · Tomahawk, WI",
  /** Shared Facebook group — fallback target for photo sharing. */
  facebookGroupUrl: "https://www.facebook.com/share/g/1B7Z7eVBnb/?mibextid=wwXIfr",
  /** Cost to attend, shown on the Pay screen. Kids' price still TBD. */
  dues: { perAdult: "$100", perKid: "TBD", per: "for the week" },
  // A volunteer/planning contact used to be hard-coded here (name + personal
  // email + phone) but it was never actually read by any component (grep
  // confirms no consumer) and shipped that PII into the public client bundle
  // for nothing — removed. The real point of contact for committee stuff is
  // the Family Fest committee roster (COMMITTEES above / `committee_roster` in
  // Supabase); the resort-wide human escape hatch is `lib/resortConfig.ts`
  // (`fetchResortConfig()`, used by /help).
  highlights: [
    { id: "welcome-bonfire", day: "2026-07-27", start: "19:30", title: "Welcome bonfire & s'mores", emoji: "🔥" },
    { id: "musky-tournament", day: "2026-07-29", start: "06:00", title: "Musky fishing tournament", emoji: "🎣" },
    { id: "talent-show", day: "2026-07-30", start: "19:00", title: "Family talent show", emoji: "🎤" },
    { id: "fireworks", day: "2026-07-31", start: "21:30", title: "Fireworks over the lake", emoji: "🎆" },
  ] as FestHighlight[],
};

/**
 * Seed resort events that live in CODE rather than the database: Family Fest
 * (synthesized from the FAMILY_FEST window above so its dates have one source of
 * truth and stay tied to the season model) and the 4th of July weekend.
 * Admin-created events (Work Weekends, custom) come from Supabase and merge on
 * top of these in lib/events.ts (deduped by slug). `persisted: false` ⇒ not
 * editable in-app — Family Fest's dates change here; holiday dates are set here.
 *
 * Family Fest stays the app's headline (its own season takeover on Home); the 4th
 * weekend is just the soonest event people RSVP to. Attendance works for both: it
 * keys on the stable string `id` (migration 0035), so members can RSVP to these
 * exactly like a DB event.
 */
export const RESORT_EVENTS: ResortEvent[] = [
  {
    id: "family-fest-2026",
    slug: "family-fest-2026",
    kind: "family_fest",
    title: FAMILY_FEST.name,
    emoji: "🎪",
    location: FAMILY_FEST.location,
    startDate: FAMILY_FEST.startDate,
    endDate: FAMILY_FEST.endDate,
    dayRsvp: true,
    source: "admin",
    persisted: false,
  },
  {
    id: "up-north-4th-2026",
    slug: "up-north-4th-2026",
    kind: "holiday",
    title: "Up North for the 4th",
    emoji: "🎆",
    description:
      "The 4th of July weekend Up North — fireworks, cookouts, and time on the water. Let everyone know if you're heading up.",
    location: "Muskellunge Lake Resort",
    // Independence Day 2026 falls on a Saturday — the long weekend runs Fri–Sun.
    startDate: "2026-07-03",
    endDate: "2026-07-05",
    dayRsvp: false,
    source: "admin",
    persisted: false,
  },
];

/** The week's agenda — the full Sunday-to-Saturday lineup. **Titles are
 *  real**; times, locations, and details are still being set, so they read
 *  "TBD" (no placeholders). Times are omitted until set (the UI shows "TBD").
 *  Each night's dinner is its own DINNERS entry below, not repeated here.
 *  Fill in `start`/`location`/`description`/`lead` as each is decided. */
export const SCHEDULE: ScheduleEvent[] = [
  {
    id: "setup-decorate",
    day: "2026-07-26",
    title: "Set Up & Decorate",
    location: "TBD",
    emoji: "🎨",
    description: "Details TBD.",
  },
  {
    id: "ye-olde-family-faire",
    day: "2026-07-27",
    title: "“Ye Olde Family Faire” (Costumes!)",
    location: "Up top",
    emoji: "🏰",
    description: "Costumes encouraged! Details TBD.",
  },
  {
    id: "gene-pool-concert",
    day: "2026-07-27",
    title: "Gene Pool Concert",
    location: "TBD",
    emoji: "🎸",
    description: "Details TBD.",
  },
  {
    id: "lake-day",
    day: "2026-07-28",
    title: "Lake Day",
    location: "TBD",
    emoji: "🏖️",
    description: "Details TBD.",
  },
  {
    id: "cookout-by-the-lake",
    day: "2026-07-28",
    title: "Cook Out by the Lake",
    location: "By the lake",
    emoji: "🍔",
    description: "Details TBD.",
  },
  {
    id: "golf-day",
    day: "2026-07-29",
    title: "Golf Day (Costumes Welcome)",
    location: "TBD",
    emoji: "⛳",
    description: "Costumes welcome. Details TBD.",
  },
  {
    id: "trivia-night",
    day: "2026-07-29",
    title: "Trivia Night",
    location: "TBD",
    emoji: "🧠",
    description: "Details TBD.",
  },
  {
    id: "bags-tournament",
    day: "2026-07-30",
    title: "Bags Tournament",
    location: "TBD",
    emoji: "🎯",
    description: "Details TBD.",
  },
  {
    id: "variety-show",
    day: "2026-07-30",
    title: "Variety Show",
    location: "TBD",
    emoji: "🎭",
    description: "Hosted by Michelle Birkholz. Details TBD.",
    lead: { name: "Michelle Birkholz" },
  },
  {
    id: "breakfast",
    day: "2026-07-31",
    title: "Breakfast",
    location: "TBD",
    emoji: "🥞",
    description: "Details TBD.",
  },
  {
    id: "family-meeting",
    day: "2026-07-31",
    title: "Family Meeting",
    location: "TBD",
    emoji: "🗣️",
    description: "Details TBD.",
  },
  {
    id: "karaoke",
    day: "2026-07-31",
    title: "Karaoke",
    location: "TBD",
    emoji: "🎤",
    description: "Details TBD.",
  },
  {
    id: "teardown-cleanup",
    day: "2026-08-01",
    title: "Tear Down & Clean Up",
    location: "TBD",
    emoji: "🧹",
    description: "Details TBD.",
  },
];

/** "Things to do" that run ALL WEEK with no set time — distinct from the timed
 *  SCHEDULE. Do them whenever. (More of these will be added over time.) */
export const THINGS_TO_DO: FestActivity[] = [
  {
    id: "scavenger-hunt",
    title: "Family Fest scavenger hunt",
    emoji: "🗺️",
    blurb: "Track down hidden landmarks & oddities around the lake — any time, all week.",
    details:
      "Pick up a hunt card at the lodge, then find each spot around Muskellunge Lake at your own pace — solo, as a family, or as a house. Finish the list any day and turn it in at the lodge for a prize at the farewell BBQ.",
    location: "Pick up your card at the Main Lodge",
  },
  {
    id: "merch",
    title: "Family Fest merch",
    emoji: "👕",
    blurb: "Grab this year's Family Fest gear — any time, all week.",
    details: "Details TBD.",
    location: "TBD",
  },
  {
    id: "kids-activities",
    title: "Kid-focused activities",
    emoji: "🧒",
    blurb: "Games and crafts for the youngest crew — any time, all week.",
    details: "Details TBD.",
    location: "TBD",
  },
];

/**
 * Each night's dinner and head chef. **Head chefs are real**; the menus, crew
 * houses, and serve/prep times are still being set, so they read **TBD** for now
 * (no placeholders). Fill them in as they're decided. Chef phones get added once
 * the chefs link their accounts.
 * GOOGLE DRIVE SEAM: replace with a fetch that maps a Drive file → Dinner[].
 */
export const DINNERS: Dinner[] = [
  {
    id: "d-mon",
    day: "2026-07-27",
    title: "Monday Dinner",
    emoji: "🍽️",
    chef: { name: "Jessica Stewart" },
    houses: [],
    menu: "TBD",
    prepTime: "TBD",
    time: "TBD",
    location: "TBD",
  },
  {
    id: "d-tue",
    day: "2026-07-28",
    title: "Tuesday Dinner",
    emoji: "🍽️",
    chef: { name: "Natalie de Pareja & Karen" },
    houses: [],
    menu: "TBD",
    prepTime: "TBD",
    time: "TBD",
    location: "TBD",
  },
  {
    id: "d-wed",
    day: "2026-07-29",
    title: "Wednesday Dinner",
    emoji: "🍽️",
    chef: { name: "Lauren Zerfas" },
    houses: [],
    menu: "TBD",
    prepTime: "TBD",
    time: "TBD",
    location: "TBD",
  },
  {
    id: "d-thu",
    day: "2026-07-30",
    title: "Thursday Dinner",
    emoji: "🍽️",
    chef: { name: "Rob & Joe" },
    houses: [],
    menu: "TBD",
    prepTime: "TBD",
    time: "TBD",
    location: "TBD",
  },
  {
    id: "d-fri",
    day: "2026-07-31",
    title: "Friday Dinner",
    emoji: "🍽️",
    chef: { name: "TBD" },
    houses: [],
    menu: "TBD",
    prepTime: "TBD",
    time: "TBD",
    location: "TBD",
  },
];

/**
 * People to pay for the fest, via Venmo (preferred) or Zelle. Placeholders —
 * fill in the real handles. No credentials live in the app: buttons open Venmo
 * or copy the Zelle handle so payment happens in the user's own app.
 */
export const PAYEES: Payee[] = [
  { id: "dues", name: "Cathy Hofer", role: "Family Fest dues — collects for the week", venmo: "Cathy-Hofer-1" },
];

/** Days of the fest as ISO strings, derived from the event window. */
export function eventDays(): string[] {
  const days: string[] = [];
  const start = new Date(FAMILY_FEST.startDate + "T00:00:00");
  const end = new Date(FAMILY_FEST.endDate + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
