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
  { id: "p1", author: "Aunt Linda", ts: "2026-05-31T23:10:00Z", text: "Counting down — can't wait to see everyone at the lake! 🥳", likes: 4 },
  { id: "p2", author: "Grandpa", ts: "2026-05-31T20:00:00Z", text: "First musky of the season 🎣", gradient: "from-teal-300 to-cyan-500", emoji: "🎣", likes: 9 },
  { id: "p3", author: "Cousin Sam", ts: "2026-05-30T18:30:00Z", text: "Sunset off the main dock 🌅", gradient: "from-amber-300 to-rose-400", emoji: "🌅", likes: 6 },
  { id: "p4", author: "The Petersons", ts: "2026-05-29T15:00:00Z", text: "Who's bringing the cornhole boards this year?", likes: 2 },
];

/**
 * Resort committees — year-round volunteer groups.
 *
 * Family Fest's roster is the **real** committee: each person's `roles[]` are
 * the areas they own within the one Family Fest committee (Meals, Entertainment
 * & Games, etc. — these are roles, not separate committees). Most don't have an
 * account yet, so they have a display first name but no `email`/`phone`; those
 * get filled in (and the name swapped to their account) once they link up. Brian
 * is the one with contact on file for now. Phones are E.164 so tel:/sms: work.
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
    // `email` is the stable identity key: it's how a roster slot LINKS to a real
    // account (matched against `profiles.contact_email`, which Supabase seeds
    // from each person's login email on signup) so the placeholder upgrades to
    // their account — name/avatar then follow their profile — with no duplicate
    // entry. See lib/committees.ts + components/CommitteeRoster.tsx. A few people
    // haven't given an email yet (name-match is the fallback there).
    members: [
      { name: "Lauren Birkholz", roles: ["Meals · Lead"] },
      { name: "Jessica Theis", roles: ["Meals", "Merchandise, Fundraising & Polling", "Logistics, Scheduling & Finance"] },
      { name: "Rob Hermanson", roles: ["Meals", "Logistics, Scheduling & Finance"], email: "rob.hermanson@yahoo.com" },
      { name: "Lisa Gorge", roles: ["Meals"], email: "lisagorge20@gmail.com" },
      { name: "Matthew Vinezeano", roles: ["Meals", "Entertainment & Games"], email: "mvinezeano10@gmail.com" },
      { name: "Kity Theis", roles: ["Meals", "Logistics, Scheduling & Finance"], email: "grandmakity@gmail.com" },
      { name: "Natalie Theis de Pareja", roles: ["Meals", "Entertainment & Games"], email: "windycity531@yahoo.com" },
      { name: "Keith Thibodeau", roles: ["Entertainment & Games · Lead"], email: "kay.are.tibbs@gmail.com" },
      { name: "Rick Gorge", roles: ["Entertainment & Games", "Merchandise, Fundraising & Polling · Lead"], email: "rickgorge@gmail.com" },
      { name: "Markus Hofer", roles: ["Entertainment & Games"], email: "hofermarkus82@gmail.com" },
      { name: "Karen Theis", roles: ["Entertainment & Games"], email: "kaelth6255@gmail.com" },
      { name: "Zack Kauranen", roles: ["Entertainment & Games"], email: "zkauranen@yahoo.com" },
      { name: "Abbie Theis", roles: ["Entertainment & Games", "Art & Decorating", "Merchandise, Fundraising & Polling"], email: "theisabigail@gmail.com" },
      { name: "Brian Theis", roles: ["Entertainment & Games", "Merchandise, Fundraising & Polling", "Logistics, Scheduling & Finance"], email: "brian.theis15@gmail.com", phone: "+12248005389" },
      { name: "Jenny Snively", roles: ["Art & Decorating · Lead"], email: "jayellebee29@gmail.com" },
      { name: "Christy Gorge", roles: ["Art & Decorating"], email: "christymgorge@gmail.com" },
      { name: "Lindsay Thibodeau", roles: ["Art & Decorating"], email: "lindsayfier@gmail.com" },
      { name: "Ellie", roles: ["Art & Decorating"] },
      { name: "Michelle Birkholz", roles: ["Art & Decorating"], email: "michellebirkholz@gmail.com" },
      { name: "Cathy Hofer", roles: ["Logistics, Scheduling & Finance · Lead"], email: "cathanndude@gmail.com" },
      { name: "Cassie Paparigian", roles: ["Logistics, Scheduling & Finance"], email: "cpaparigian@gmail.com" },
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
  startDate: "2026-07-27",
  endDate: "2026-07-31",
  location: "Muskellunge Lake Resort",
  address: "Muskellunge Lake · 5 mi from Tomahawk on Hwy 8 · Tomahawk, WI",
  /** Shared Facebook group — fallback target for photo sharing. */
  facebookGroupUrl: "https://www.facebook.com/share/g/1B7Z7eVBnb/?mibextid=wwXIfr",
  /** Cost to attend, shown on the Pay screen. Kids' price still TBD. */
  dues: { perAdult: "$100", perKid: "TBD", per: "for the week" },
  /** Volunteer / planning contact, surfaced during the "planning" season so
   *  people can reach out to help (tap-to-email / tap-to-call). A real point of
   *  contact for now; this moves to the Committees feature once there's a
   *  backend (NEXT-STEPS §5c). Phone is E.164 so tel:/sms: work everywhere. */
  organizer: {
    name: "Brian Theis",
    email: "brian.theis15@gmail.com",
    phone: "+12248005389",
  },
  highlights: [
    { id: "welcome-bonfire", day: "2026-07-27", start: "19:30", title: "Welcome bonfire & s'mores", emoji: "🔥" },
    { id: "musky-tournament", day: "2026-07-29", start: "06:00", title: "Musky fishing tournament", emoji: "🎣" },
    { id: "talent-show", day: "2026-07-30", start: "19:00", title: "Family talent show", emoji: "🎤" },
    { id: "fireworks", day: "2026-07-31", start: "21:30", title: "Fireworks over the lake", emoji: "🎆" },
  ] as FestHighlight[],
};

/**
 * The 2026 t-shirt design vote. Four designs from three family artists; the
 * family ranks them (ranked choice) in a Google Form that also locks in the
 * final headcount + dietary restrictions. Surfaced during the planning run-up:
 *   - a Home call-out (components/TshirtCallout.tsx),
 *   - the in-app preview gallery (app/family-fest/shirts/page.tsx — tap any
 *     design to see it full-screen before voting),
 *   - the "Order T-Shirts" tile on the Family Fest hub (FestDuesShirts).
 * Self-hides everywhere once `deadline` passes. Images are bundled in
 * /public/ff/shirts so the gallery works offline / even if the mini is down.
 * When the next year's vote opens, swap the form URL, deadline, and designs.
 */
export const TSHIRT_VOTE = {
  /** "Vote & RSVP" Google Form (ranked choice + headcount + dietary). */
  formUrl: "https://forms.gle/8aVV4b7vtkpKUm7N7",
  /** Last day to vote, inclusive (ISO "YYYY-MM-DD"). Saturday, June 27 2026. */
  deadline: "2026-06-27",
  /** Ranked-choice vote — the family ranks the four designs. */
  rankedChoice: true,
  /** Kids this age and up may vote too (per the committee's note). */
  minVoterAge: 6,
  designs: [
    {
      id: "olde-fantasy",
      name: "Olde Fantasy",
      artist: "Rick G",
      img: "/ff/shirts/olde-fantasy.jpg",
      blurb:
        "A hand-inked treasure map of Ye Olde Family Feste — sea serpent, castle, and a compass-rose crest, in heritage navy. Front pocket mark with the full map across the back.",
    },
    {
      id: "swordstone",
      name: "SwordStone",
      artist: "Rick G",
      img: "/ff/shirts/swordstone.jpg",
      blurb:
        "Woodcut-style sword in the stone, a hoarding dragon, and a knight riding out on the quest, under a smiling sun. Shown on maroon and forest green.",
    },
    {
      id: "tomahawk-quest",
      name: "Tomahawk Quest",
      artist: "Abbie",
      img: "/ff/shirts/tomahawk-quest.jpg",
      blurb:
        "An ornate dragon crest up front and a detailed Muskellunge Lake quest map — with a numbered key — across the back. Inky black line art.",
    },
    {
      id: "toon-knight",
      name: "ToonKnight",
      artist: "Evan",
      img: "/ff/shirts/toon-knight.jpg",
      blurb:
        "A friendly cartoon knight raising sword and banner in hand-lettered script — the playful, kid-favorite option. Comes in a red and a grey knight.",
    },
  ],
} as const;

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
    description: FAMILY_FEST.tagline,
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
      "The 4th of July weekend at the lake — fireworks, cookouts, and time on the water. Let everyone know if you're heading up.",
    location: "Muskellunge Lake Resort",
    // Independence Day 2026 falls on a Saturday — the long weekend runs Fri–Sun.
    startDate: "2026-07-03",
    endDate: "2026-07-05",
    dayRsvp: false,
    source: "admin",
    persisted: false,
  },
];

/** The week's agenda — one headline activity per day so far. **Titles are
 *  real**; times, locations, and details are still being set, so they read
 *  "TBD" (no placeholders). Times are omitted until set (the UI shows "TBD").
 *  Fill in `start`/`location`/`description`/`lead` as each is decided. */
export const SCHEDULE: ScheduleEvent[] = [
  {
    id: "games-up-top",
    day: "2026-07-27",
    title: "Games Up Top",
    location: "TBD",
    emoji: "🏅",
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
    id: "golf-outing",
    day: "2026-07-29",
    title: "Golf Outing",
    location: "TBD",
    emoji: "⛳",
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
    id: "friday-tbd",
    day: "2026-07-31",
    title: "TBD",
    location: "TBD",
    emoji: "🗓️",
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
    chef: { name: "Jessica Theis" },
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
    chef: { name: "Lauren" },
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
