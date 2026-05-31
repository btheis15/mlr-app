/**
 * Seed data for the Muskellunge Lake Resort app. Client-only for now (no
 * backend), so resort info, activities, dining, and the embedded Family Fest
 * highlights live here as static data. Runtime/user data (identity, chat) is
 * layered on via localStorage in the client views. Announcements have their own
 * module (lib/announcements.ts) because that's the seam a Google-Drive feed
 * plugs into.
 */

import type { Activity, Amenity, ChatMessage, DiningSpot, FestHighlight } from "./types";

/**
 * Admins can push alerts to everyone. For now this is a hard-coded allow-list
 * matched by email; when there's a backend, this check moves server-side (and
 * the role lives on the user record) so it can't be spoofed from the client.
 */
export const ADMIN_EMAILS: string[] = ["brian@innjoybnb.com"];

export function isAdmin(email: string | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

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

export const ACTIVITIES: Activity[] = [
  {
    id: "pontoon",
    name: "Pontoon rental",
    emoji: "🛥️",
    category: "On the water",
    hours: "Daily · 8am–dusk",
    location: "Main dock",
    description: "Cruise the lake on a 10-person pontoon. Reserve at the front desk; life jackets included.",
    price: "$120 / half day",
  },
  {
    id: "musky-guide",
    name: "Guided musky fishing",
    emoji: "🎣",
    category: "On the water",
    hours: "Trips at 6am & 1pm",
    location: "Boathouse",
    description: "Half-day trip with a local guide chasing the lake's namesake. Gear and bait provided.",
    price: "$250 / boat",
  },
  {
    id: "kayak",
    name: "Kayaks & paddleboards",
    emoji: "🛶",
    category: "On the water",
    hours: "Daily · dawn–dusk",
    location: "Swim beach rack",
    description: "Grab a kayak or SUP off the rack any time. First come, first served.",
    price: "Free for guests",
  },
  {
    id: "swim",
    name: "Swim beach",
    emoji: "🏖️",
    category: "On the water",
    hours: "Daily · sunrise–10pm",
    location: "South shore",
    description: "Sandy, roped swim area with a floating dock. No lifeguard on duty.",
    price: "Free",
  },
  {
    id: "trails",
    name: "Hiking & nature trails",
    emoji: "🥾",
    category: "On land",
    hours: "Always open",
    location: "Trailhead by the lodge",
    description: "3 miles of marked trails through the pines. Maps at the front desk.",
    price: "Free",
  },
  {
    id: "tennis",
    name: "Courts & lawn games",
    emoji: "🎾",
    category: "On land",
    hours: "Daily · 8am–9pm",
    location: "Behind cabins 4–6",
    description: "Tennis, pickleball, bocce, and a horseshoe pit. Equipment in the bin.",
    price: "Free",
  },
  {
    id: "gameroom",
    name: "Lodge game room",
    emoji: "🎱",
    category: "For kids",
    hours: "Daily · 9am–10pm",
    location: "Lower lodge",
    description: "Pool table, foosball, arcade classics, and a wall of board games.",
    price: "Free",
  },
  {
    id: "bonfire",
    name: "Nightly lakeside bonfire",
    emoji: "🔥",
    category: "Evening",
    hours: "Nightly · 8pm",
    location: "Lakeside fire pit",
    description: "Firewood and roasting sticks provided. Bring a chair and a story.",
    price: "Free",
  },
];

export const DINING: DiningSpot[] = [
  {
    id: "lodge",
    name: "The Lodge Restaurant",
    emoji: "🍽️",
    hours: "Breakfast 7–10 · Dinner 5–9",
    description: "Sit-down dining with a lake view. Walleye Fridays. Reservations for parties of 6+.",
  },
  {
    id: "dockside",
    name: "Dockside Grill",
    emoji: "🍔",
    hours: "Daily · 11am–7pm",
    description: "Burgers, baskets, and ice cream right on the water. Order at the window.",
  },
  {
    id: "store",
    name: "General Store",
    emoji: "🛒",
    hours: "Daily · 7am–9pm",
    description: "Groceries, bait, firewood, sunscreen, and the essentials you forgot.",
  },
  {
    id: "coffee",
    name: "Boathouse Coffee",
    emoji: "☕",
    hours: "Daily · 6:30–11am",
    description: "Espresso, drip, and fresh muffins. Early enough for the 6am fishing crowd.",
  },
];

export const AMENITIES: Amenity[] = [
  { id: "wifi", label: "Guest WiFi", value: `${RESORT.wifiNetwork} · ${RESORT.wifiPassword}`, emoji: "📶" },
  { id: "checkin", label: "Check-in / out", value: `${RESORT.checkIn} / ${RESORT.checkOut}`, emoji: "🔑" },
  { id: "laundry", label: "Laundry", value: "Behind the lodge · 24h · coin-op", emoji: "🧺" },
  { id: "launch", label: "Boat launch", value: "North end · permit at front desk", emoji: "⚓" },
  { id: "trash", label: "Trash & recycling", value: "Bear-proof bins by each cabin cluster", emoji: "♻️" },
  { id: "quiet", label: "Quiet hours", value: "10pm–7am", emoji: "🤫" },
];

/** Mirror of the Family Fest event for the embedded hub. Kept lightweight; the
 *  full experience lives in the standalone family-fest app. */
export const FAMILY_FEST = {
  name: "Family Fest 2026",
  tagline: "One week. The whole clan. The lake.",
  /** 2026 theme (from the poster); official title still TBD. */
  theme: "Renaissance · Fantasy",
  themeNote: "Official title coming soon",
  startDate: "2026-07-11",
  endDate: "2026-07-18",
  /** Deployed standalone Family Fest app (the deep experience). */
  appUrl: "https://family-fest.vercel.app",
  highlights: [
    { id: "welcome-bonfire", day: "2026-07-11", start: "19:30", title: "Welcome bonfire & s'mores", emoji: "🔥" },
    { id: "musky-tournament", day: "2026-07-13", start: "06:00", title: "Musky fishing tournament", emoji: "🎣" },
    { id: "talent-show", day: "2026-07-16", start: "19:00", title: "Family talent show", emoji: "🎤" },
    { id: "fireworks", day: "2026-07-17", start: "21:30", title: "Fireworks over the lake", emoji: "🎆" },
  ] as FestHighlight[],
};

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
