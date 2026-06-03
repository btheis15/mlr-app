/**
 * Seed data for the Muskellunge Lake Resort app. Client-only for now (no
 * backend), so resort info and the embedded Family Fest
 * highlights live here as static data. Runtime/user data (identity, chat) is
 * layered on via localStorage in the client views. Announcements have their own
 * module (lib/announcements.ts) because that's the seam a Google-Drive feed
 * plugs into.
 */

import type {
  ChatMessage,
  Committee,
  CrewMember,
  Dinner,
  FestActivity,
  FestHighlight,
  Memory,
  Payee,
  Post,
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
 * Resort committees — year-round volunteer groups. Members below are
 * ILLUSTRATIVE placeholders (made-up names + example.com emails + 555 phones)
 * to show how the rosters read; swap in the real people later. Phones are E.164
 * so tel:/sms: work everywhere.
 */
export const COMMITTEES: Committee[] = [
  {
    slug: "resort-maintenance",
    name: "Resort Maintenance",
    emoji: "🛠️",
    description: "Cabin upkeep, docks, mowing, and getting the grounds ready each season.",
    members: [
      { name: "Dale Whitaker", role: "Lead", email: "dale.whitaker@example.com", phone: "+17155550201" },
      { name: "Marie Olson", email: "marie.olson@example.com", phone: "+17155550202" },
      { name: "Greg Sandberg", email: "greg.sandberg@example.com", phone: "+17155550203" },
    ],
  },
  {
    slug: "family-fest",
    name: "Family Fest",
    emoji: "🎉",
    description:
      "The big one — plans the whole week. Each person owns one or more areas (meals, events, scavenger hunt, and more).",
    members: [
      { name: "Cathy Hofer", role: "Lead", roles: ["Finances", "Meals"], email: "cathy.hofer@example.com", phone: "+17155550211" },
      { name: "Brian Theis", roles: ["Events", "Scavenger Hunt", "App & comms"], email: "brian.theis15@gmail.com", phone: "+12248005389" },
      { name: "Susan Park", roles: ["Talent show", "Kids' activities"], email: "susan.park@example.com", phone: "+17155550212" },
      { name: "Rick Hofer", roles: ["Dinners & grilling"], email: "rick.hofer@example.com", phone: "+17155550213" },
      { name: "Megan Doyle", roles: ["Photos & memories"], email: "megan.doyle@example.com", phone: "+17155550214" },
      { name: "Paul Stenberg", roles: ["Setup & cleanup"], email: "paul.stenberg@example.com", phone: "+17155550215" },
      { name: "Diane Kessler", roles: ["Welcome & registration"], email: "diane.kessler@example.com", phone: "+17155550240" },
      { name: "Mark Donnelly", roles: ["Fishing tournament"], email: "mark.donnelly@example.com", phone: "+17155550241" },
      { name: "Karen Voss", roles: ["Decorations"], email: "karen.voss@example.com", phone: "+17155550242" },
      { name: "Joe Ferris", roles: ["Bonfire & firewood"], email: "joe.ferris@example.com", phone: "+17155550243" },
      { name: "Beth Calloway", roles: ["Supplies & shopping", "Meals"], email: "beth.calloway@example.com", phone: "+17155550244" },
      { name: "Tony Marchetti", roles: ["Music & DJ"], email: "tony.marchetti@example.com", phone: "+17155550245" },
      { name: "Laura Quinn", roles: ["Kids' activities", "Crafts"], email: "laura.quinn@example.com", phone: "+17155550246" },
    ],
  },
  {
    slug: "beautification",
    name: "Beautification",
    emoji: "🌲",
    description: "Planting, flower beds, trails, and keeping the resort looking its best.",
    members: [
      { name: "Linda Brauer", role: "Lead", email: "linda.brauer@example.com", phone: "+17155550221" },
      { name: "Tom Becker", email: "tom.becker@example.com", phone: "+17155550222" },
      { name: "Janet Cole", email: "janet.cole@example.com", phone: "+17155550223" },
    ],
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
  /** Heritage (from the original resort's business card + the EST-1987 logo). */
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
  /** 2026 theme (from the poster); official title still TBD. */
  theme: "Renaissance · Fantasy",
  themeNote: "Official title coming soon",
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

/** The week's timed agenda, in chronological order. Each event has time,
 *  location, a `lead` (who's in charge, tap-to-call/text) + a `bring` note. */
export const SCHEDULE: ScheduleEvent[] = [
  {
    id: "arrival",
    day: "2026-07-27",
    start: "15:00",
    title: "Arrival & check-in",
    location: "Main Lodge",
    emoji: "🛻",
    description:
      "Roll in, grab your cabin keys at the lodge, and settle the kids. Coolers to the boathouse fridge.",
    lead: { name: "Steward Eadric of House Larkspur", phone: "+17155550140" },
    bring: "Your cabin confirmation & a cooler for the boathouse fridge.",
  },
  {
    id: "welcome-bonfire",
    day: "2026-07-27",
    start: "19:30",
    title: "Welcome bonfire & s'mores",
    location: "Lakeside fire pit",
    emoji: "🔥",
    description:
      "Kick off the week by the water. Marshmallows and firewood provided — bring a chair and your stories.",
    lead: { name: "Baron Aldric of House Thornwood", phone: "+17155550127" },
    bring: "A camp chair & your best lake stories.",
  },
  {
    id: "pancake-breakfast",
    day: "2026-07-28",
    start: "08:00",
    end: "10:00",
    title: "Pancake breakfast",
    location: "Lodge deck",
    emoji: "🥞",
    description: "Grandpa's famous blueberry pancakes. Coffee's on by 7:30.",
    lead: { name: "Master Tobias of House Fenwick", phone: "+17155550141" },
    bring: "Just an appetite (and your favorite syrup, if you're picky).",
  },
  {
    id: "pontoon-parade",
    day: "2026-07-28",
    start: "13:00",
    title: "Pontoon parade",
    location: "Main dock",
    emoji: "🛥️",
    description:
      "Deck out the pontoons and cruise the bay. Best-decorated boat wins the golden paddle.",
    lead: { name: "Captain Rowan of House Eldermoor", phone: "+17155550142" },
    bring: "Decorations for your boat & plenty of sunscreen.",
  },
  {
    id: "musky-tournament",
    day: "2026-07-29",
    start: "06:00",
    end: "12:00",
    title: "Musky fishing tournament",
    location: "North bay",
    emoji: "🎣",
    description:
      "The big one. Two-person boats, catch-and-release, biggest musky takes the trophy. Early start — coffee at the dock.",
    lead: { name: "Master Bartholomew of House Eldermoor", phone: "+17155550129" },
    bring: "Rod, reel, a thermos — and a partner for your boat.",
  },
  {
    id: "kids-olympics",
    day: "2026-07-29",
    start: "10:00",
    title: "Kids' lake olympics",
    location: "Swim beach",
    emoji: "🏅",
    description:
      "Cannonball contest, sandcastle build-off, and the legendary tube relay.",
    lead: { name: "Lady Wynne of House Larkspur", phone: "+17155550143" },
    bring: "Swimsuit, towel, and a competitive spirit.",
  },
  {
    id: "cousins-cookout",
    day: "2026-07-30",
    start: "17:30",
    title: "Cousins' cookout (potluck)",
    location: "Pavilion",
    emoji: "🍔",
    description:
      "Everyone brings a dish — see the Crew tab for who's got what. Grill fired up at 5.",
    lead: { name: "Goodwife Maren of House Hollowbrook", phone: "+17155550130" },
    bring: "A dish to share — check the Crew board so we don't get six potato salads.",
  },
  {
    id: "talent-show",
    day: "2026-07-30",
    start: "19:00",
    title: "Family talent show",
    location: "Lodge great room",
    emoji: "🎤",
    description:
      "Sign up at the lodge. Acts of all kinds welcome — the cheesier the better.",
    lead: { name: "Bard Percival of House Wyndmere", phone: "+17155550144" },
    bring: "An act to perform — sign up at the lodge by noon.",
  },
  {
    id: "group-photo",
    day: "2026-07-31",
    start: "11:00",
    title: "Big group photo",
    location: "Lodge front steps",
    emoji: "📸",
    description: "Everyone, all of us, matching-ish shirts. Don't be late!",
    lead: { name: "Dame Cecily of House Brightwater", phone: "+17155550128" },
    bring: "Your matching-ish shirt — and be on the steps by 11 sharp.",
  },
  {
    id: "fireworks",
    day: "2026-07-31",
    start: "21:30",
    title: "Fireworks over the lake",
    location: "Lakeside lawn",
    emoji: "🎆",
    description: "The grand finale. Blankets out, lights down, look up.",
    lead: { name: "Sir Reginald of House Pemberlye", phone: "+17155550131" },
    bring: "A blanket and a spot on the lawn — dinner's right before at 6.",
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
 * Each night's dinner and head chef. ILLUSTRATIVE demo content (Renaissance
 * "house" names, made-up 555 numbers, sample menus) showing how a fully
 * assigned week reads — swap in the real families/chefs/numbers when set.
 * GOOGLE DRIVE SEAM: replace with a fetch that maps a Drive file → Dinner[].
 */
export const DINNERS: Dinner[] = [
  {
    id: "d-mon",
    day: "2026-07-27",
    title: "The Welcoming Feast",
    emoji: "🔥",
    chef: { name: "Baron Aldric of House Thornwood", phone: "+17155550127" },
    houses: ["House Thornwood", "The Ravenshire Clan", "House Larkspur"],
    menu: "Flame-charred sausages & beef rounds of the realm, fire-roasted corn, and the Baron's legendary potato salad.",
    prepTime: "4:30 PM",
    prepLocation: "Lakeside Pavilion grills",
    time: "6:00 PM",
    location: "Lakeside Pavilion",
  },
  {
    id: "d-tue",
    day: "2026-07-28",
    title: "Ye Olde Pizza Forge",
    emoji: "🍕",
    chef: { name: "Dame Cecily of House Brightwater", phone: "+17155550128" },
    houses: ["House Brightwater", "The Wyndmere Troupe"],
    menu: "Wood-fired hand pies & flatbreads from the dock forge, a garden-greens salad, and lemon ices for the squires.",
    prepTime: "5:00 PM",
    prepLocation: "Dock pizza oven",
    time: "6:30 PM",
    location: "Main Dock",
  },
  {
    id: "d-wed",
    day: "2026-07-29",
    title: "Dragonscale Fish Fry",
    emoji: "🐟",
    chef: { name: "Master Bartholomew of House Eldermoor", phone: "+17155550129" },
    houses: ["House Eldermoor", "The Ashforge Family", "House Fenwick"],
    menu: "Beer-battered walleye from the day's catch, golden hush puppies, and slaw of the realm.",
    prepTime: "4:00 PM",
    prepLocation: "Boathouse kitchen",
    time: "5:30 PM",
    location: "Boathouse",
  },
  {
    id: "d-thu",
    day: "2026-07-30",
    title: "The Cousins' Grand Potluck Banquet",
    emoji: "🍔",
    chef: { name: "Goodwife Maren of House Hollowbrook", phone: "+17155550130" },
    houses: ["House Hollowbrook", "The Stagleigh Kin", "House Marrowin"],
    menu: "A long table of dishes from every house (see the Crew board), with the Goodwife's grill lit at 5.",
    prepTime: "4:30 PM",
    prepLocation: "Pavilion",
    time: "5:30 PM",
    location: "Pavilion",
  },
  {
    id: "d-fri",
    day: "2026-07-31",
    title: "The Farewell Pig Roast",
    emoji: "🍖",
    chef: { name: "Sir Reginald of House Pemberlye", phone: "+17155550131" },
    houses: ["House Pemberlye", "The Brightwater Family", "House Thornwood"],
    menu: "A smoked feast to send us off — slow brisket, herbed chicken, honeyed beans, and berry cobbler before the fireworks.",
    prepTime: "3:30 PM",
    prepLocation: "Lakeside Pavilion smokers",
    time: "6:00 PM",
    location: "Lakeside Pavilion",
  },
];

/** Households who've responded so far. Users can add their own in the Crew tab. */
export const CREW: CrewMember[] = [
  { id: "grandparents", name: "Grandma & Grandpa", headcount: 2, status: "yes", bringing: "Blueberry pancakes" },
  { id: "petersons", name: "The Petersons", headcount: 5, status: "yes", bringing: "Burgers & brats" },
  { id: "aunt-linda", name: "Aunt Linda", headcount: 1, status: "yes", bringing: "Famous potato salad" },
  { id: "the-js", name: "Jake & Maria", headcount: 4, status: "yes", bringing: "Corn on the cob" },
  { id: "uncle-rob", name: "Uncle Rob's crew", headcount: 3, status: "maybe", bringing: "Cooler of drinks" },
  { id: "the-coastals", name: "The California cousins", headcount: 4, status: "maybe" },
  { id: "sam", name: "Cousin Sam", headcount: 2, status: "yes", bringing: "Dessert (pies!)" },
  { id: "the-norths", name: "The Norths", headcount: 3, status: "no" },
];

/** Seed album tiles — gradient placeholders so the album looks alive without
 *  shipping image binaries. Real photos get added at runtime in the Photos view. */
export const MEMORIES: Memory[] = [
  { id: "m1", caption: "Sunset off the main dock", gradient: "from-amber-300 to-rose-400", emoji: "🌅" },
  { id: "m2", caption: "First musky of the trip", gradient: "from-teal-300 to-cyan-500", emoji: "🎣" },
  { id: "m3", caption: "Bonfire night", gradient: "from-orange-400 to-red-500", emoji: "🔥" },
  { id: "m4", caption: "Cannonball champs", gradient: "from-sky-300 to-blue-500", emoji: "💦" },
  { id: "m5", caption: "Pontoon parade winners", gradient: "from-fuchsia-300 to-purple-500", emoji: "🛥️" },
  { id: "m6", caption: "Grandpa's pancakes", gradient: "from-yellow-200 to-amber-400", emoji: "🥞" },
  { id: "m7", caption: "The whole gang", gradient: "from-lime-300 to-emerald-500", emoji: "👨‍👩‍👧‍👦" },
  { id: "m8", caption: "Fireworks finale", gradient: "from-indigo-400 to-violet-600", emoji: "🎆" },
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

/** Seed chat so the room isn't empty on first open. Real messages are stored
 *  per-device in localStorage today; a shared backend makes this multi-user. */
export const SEED_CHAT: ChatMessage[] = [
  {
    id: "seed-1",
    author: "Front Desk",
    email: "frontdesk@mlr.example",
    text: "Welcome to Muskellunge Lake Resort! Drop questions here and we'll keep everyone posted on what's happening this week. 🌲",
    ts: "2026-05-29T15:00:00Z",
  },
  {
    id: "seed-2",
    author: "Aunt Linda",
    email: "linda@example.com",
    text: "Anyone up for kayaks before the pancake breakfast tomorrow?",
    ts: "2026-05-30T13:20:00Z",
  },
];
