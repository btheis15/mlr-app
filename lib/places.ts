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

export type PlaceGroup = "golf" | "food";

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
    blurb: "Reserve a tee time right here in the app — the pro-shop number is on the booking screen if you'd rather call.",
    emoji: "⛳",
    accent: "primary",
    group: "golf",
    internalHref: "/tee-times",
    internalCta: "Book a tee time",
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
];
