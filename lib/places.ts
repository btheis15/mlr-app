/**
 * Local Places — the resort's favorite spots a short drive from the lake, shown
 * at /local-places (linked from Home). Two kinds of entry:
 *
 *  - In-app hand-off (`internalHref`): Inshalla CC routes to our own
 *    /tee-times booking screen — we keep golfers inside the app interface (which
 *    itself surfaces the pro-shop number), rather than bouncing them out.
 *  - External business (`website` + `phoneTel`, optional `menuUrl`/`orderUrl`):
 *    a card with quick links to the website, the menu, online ordering (when the
 *    business actually offers it), and a tap-to-call.
 *
 * Contact data (phones, menu/order URLs, addresses) was fetched from each
 * business's official site and independently re-verified — keep it accurate; a
 * wrong phone number is the worst bug here. Phones are E.164 so tel: works
 * everywhere. Add new spots to PLACES; the page renders them automatically.
 */

export type PlaceGroup = "golf" | "food" | "coffee";

/** One of the Northwoods palette tokens (see globals.css @theme). Picks the
 *  card's icon-chip tint + action-icon color. Kept as a key (not raw classes)
 *  so the data stays presentation-free; the card maps it to literal Tailwind
 *  classes (literal strings so Tailwind's scanner emits them). */
export type PlaceAccent = "primary" | "lake" | "campfire" | "sun" | "dusk";

export interface LocalPlace {
  slug: string;
  name: string;
  /** Short "what it is" line, e.g. "Pizza & Sports Bar". */
  category: string;
  /** Where it is, e.g. "Tomahawk, WI". */
  locality: string;
  /** One friendly sentence. */
  blurb: string;
  emoji: string;
  accent: PlaceAccent;
  group: PlaceGroup;

  // ── External business (omit all of these for an in-app hand-off) ──
  website?: string;
  /** Direct link to the menu page/PDF on the official site, if one exists. */
  menuUrl?: string;
  /** Real online-ordering URL (Toast, etc.) — only when the business offers it. */
  orderUrl?: string;
  phoneDisplay?: string;
  /** E.164, e.g. "+17154534984". */
  phoneTel?: string;

  // ── In-app hand-off (e.g. Inshalla → our /tee-times screen) ──
  internalHref?: string;
  internalCta?: string;
}

export const PLACES: LocalPlace[] = [
  {
    slug: "inshalla",
    name: "Inshalla Country Club",
    category: "Golf · Country Club",
    locality: "Tomahawk, WI",
    blurb: "Public 18-hole course with a pro shop, driving range, and bar & grill. Book your tee time right here in the app.",
    emoji: "⛳",
    accent: "primary",
    group: "golf",
    // Primary action stays an in-app hand-off to our /tee-times booking screen;
    // Call + Website are offered alongside it (no Menu/Order for golf).
    internalHref: "/tee-times",
    internalCta: "Book Tee Time",
    website: "https://inshallacc.com",
    phoneDisplay: "(715) 453-3130",
    phoneTel: "+17154533130",
  },
  {
    slug: "edgewater",
    name: "Edgewater Country Club",
    category: "Golf · Public 9-Hole",
    locality: "Tomahawk, WI",
    blurb: "Family-friendly public 9-hole course tucked along the shores of Lake Alice, just outside town.",
    emoji: "⛳",
    accent: "lake",
    group: "golf",
    website: "https://edgewaterccgolf.com",
    phoneDisplay: "(715) 453-3320",
    phoneTel: "+17154533320",
  },
  {
    slug: "pinewood",
    name: "Pinewood Country Club",
    category: "Golf · Public 18-Hole",
    locality: "Harshaw, WI",
    blurb: "Public 18-hole course open April through October, with a pro shop and online tee-time booking.",
    emoji: "⛳",
    accent: "primary",
    group: "golf",
    website: "https://www.pinewoodcc.com",
    phoneDisplay: "(715) 282-5500",
    phoneTel: "+17152825500",
  },
  {
    slug: "merrill-golf",
    name: "Merrill Golf Club",
    category: "Golf · Public 18-Hole",
    locality: "Merrill, WI",
    blurb: "18-hole championship public course with a pro shop, lessons, and a bar & grill.",
    emoji: "⛳",
    accent: "sun",
    group: "golf",
    website: "https://www.merrillgolfclub.com",
    phoneDisplay: "(715) 536-2529",
    phoneTel: "+17155362529",
  },
  {
    slug: "timber-ridge",
    name: "Timber Ridge Golf Club",
    category: "Golf · Public 18-Hole",
    locality: "Minocqua, WI",
    blurb: "Scenic 18-hole, par-72 Northwoods course with rolling elevation changes, a short drive south of Minocqua.",
    emoji: "⛳",
    accent: "campfire",
    group: "golf",
    website: "https://timberridgegolfclub.com",
    phoneDisplay: "(715) 356-9502",
    phoneTel: "+17153569502",
  },
  {
    slug: "northwood-golf",
    name: "Northwood Golf Club",
    category: "Golf · Public 18-Hole",
    locality: "Rhinelander, WI",
    blurb: "18-hole public course carved out of ancient rock and timber, with a full clubhouse, restaurant, and bar.",
    emoji: "⛳",
    accent: "dusk",
    group: "golf",
    website: "https://northwoodgolfclub.com",
    phoneDisplay: "(715) 282-6565",
    phoneTel: "+17152826565",
  },
  {
    slug: "trout-lake",
    name: "Trout Lake Golf Club",
    category: "Golf · Public 18-Hole",
    locality: "Arbor Vitae, WI",
    blurb: "The Northwoods' oldest 18-hole course (est. 1924), freshly renovated, with a driving range and a historic clubhouse.",
    emoji: "⛳",
    accent: "lake",
    group: "golf",
    website: "https://troutlakegolf.com",
    phoneDisplay: "(715) 385-2189",
    phoneTel: "+17153852189",
  },
  {
    slug: "billy-bobs",
    name: "Billy Bob's Sports Bar & Grill",
    category: "Pizza & Sports Bar",
    locality: "Tomahawk, WI",
    blurb: "Our usual pizza order — plus burgers, baskets, and the big game on.",
    emoji: "🍕",
    accent: "campfire",
    group: "food",
    website: "https://billybobssportsbarandgrill.com",
    menuUrl: "https://billybobssportsbarandgrill.com/menu/",
    phoneDisplay: "(715) 453-4984",
    phoneTel: "+17154534984",
  },
  {
    slug: "tilted-loon",
    name: "Tilted Loon",
    category: "Bar & Grill · Pizza",
    locality: "Lake Nokomis · Tomahawk, WI",
    blurb: "Lakeside saloon known for pizza, burgers, and the Friday fish fry — and it takes online orders.",
    emoji: "🍻",
    accent: "lake",
    group: "food",
    website: "https://www.tiltedloon.com",
    menuUrl: "https://www.tiltedloon.com/menus-1",
    orderUrl: "https://order.toasttab.com/online/tilted_loon",
    phoneDisplay: "(715) 453-2768",
    phoneTel: "+17154532768",
  },
  {
    slug: "outboards",
    name: "Outboards Bar & Grill",
    category: "Sports Bar & Grill",
    locality: "Downtown Tomahawk, WI",
    blurb: "Downtown bar & grill — fish fry, happy hour, and a full grill menu.",
    emoji: "🍔",
    accent: "sun",
    group: "food",
    website: "https://outboardsbarandgrill.com",
    menuUrl: "https://outboardsbarandgrill.com/menu/",
    phoneDisplay: "(715) 224-3594",
    phoneTel: "+17152243594",
  },
  {
    slug: "sideways",
    name: "Sideways Wine & Craft Beer",
    category: "Wine & Craft Beer",
    locality: "Downtown Tomahawk, WI",
    blurb: "Wine, Wisconsin craft beer, flatbreads, and charcuterie — a relaxed night out.",
    emoji: "🍷",
    accent: "dusk",
    group: "food",
    website: "https://www.sidewayswineandcraftbeer.com",
    menuUrl: "https://www.sidewayswineandcraftbeer.com/menu",
    phoneDisplay: "(715) 493-0826",
    phoneTel: "+17154930826",
  },
  {
    slug: "northwoods-cafe",
    name: "Northwoods Cafe & Coffeehouse",
    category: "Cafe & Coffeehouse",
    locality: "Tomahawk, WI",
    blurb: "A cozy, family-run downtown cafe serving breakfast, lunch, and specialty coffee drinks.",
    emoji: "☕",
    accent: "campfire",
    group: "coffee",
    website: "https://northwoods-cafe.square.site",
    phoneDisplay: "(715) 453-6280",
    phoneTel: "+17154536280",
  },
  {
    slug: "whats-brewin",
    name: "What's Brewin' Coffee Shop",
    category: "Coffee House & Cafe",
    locality: "Downtown Tomahawk, WI",
    blurb: "Downtown coffee shop pairing gourmet coffee and cold brew with homemade soups, sandwiches, baked goods, and fudge.",
    emoji: "☕",
    accent: "dusk",
    group: "coffee",
    website: "https://www.facebook.com/whatsbrewintomahawk/",
    phoneDisplay: "(715) 453-3555",
    phoneTel: "+17154533555",
  },
  {
    slug: "rise-coffee",
    name: "Rise Coffee Co.",
    category: "Coffee & Espresso",
    locality: "Tomahawk, WI",
    blurb: "A friendly mother-daughter drive-thru serving fresh espresso and coffee on the go.",
    emoji: "☕",
    accent: "sun",
    group: "coffee",
    website: "https://risecoffeetomahawk.com",
    phoneDisplay: "(715) 966-1311",
    phoneTel: "+17159661311",
  },
  {
    slug: "lakeside-bistro",
    name: "Lakeside Bistro & Boutique",
    category: "Coffee Bar & Bakery",
    locality: "Lake Nokomis · Tomahawk, WI",
    blurb: "A lakeside bistro on Lake Nokomis with a full coffee bar, daily fresh bakery, and light lunch.",
    emoji: "🥐",
    accent: "lake",
    group: "coffee",
    website: "https://lakeside-bistro-boutique.square.site",
  },
];
