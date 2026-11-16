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
 * everywhere.
 *
 * SOURCE OF TRUTH: since migration 0225 the list lives in the `local_places`
 * table and admins edit it in-app (/admin/local-places). `PLACES` below is now
 * ONLY the offline / first-paint fallback (and the migration's seed): it is used
 * when the table read ERRORS (table missing, offline), never when the table is
 * merely empty. Changing a phone number? Do it in the admin editor, not here.
 */

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { prepareImageForUpload } from "@/lib/media";

/** Known groups keep their labels; the DB allows any string (an unknown one
 *  renders as its own title-cased section). */
export type PlaceGroup = "golf" | "food" | "coffee";

/** One of the Northwoods palette tokens (see globals.css @theme). Picks the
 *  card's icon-chip tint + action-icon color. Kept as a key (not raw classes)
 *  so the data stays presentation-free; the card maps it to literal Tailwind
 *  classes (literal strings so Tailwind's scanner emits them). */
export type PlaceAccent = "primary" | "lake" | "campfire" | "sun" | "dusk";

export interface LocalPlace {
  /** DB row id (absent on the in-code fallback list). */
  id?: string;
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
  /** golf | food | coffee, or any other string (its own section). */
  group: string;
  /** Street address, shown on the card when present. */
  address?: string;
  /** Optional photo (site-assets public URL). */
  imageUrl?: string;
  /** Sort order within the group. */
  position?: number;
  /** False = hidden from everyone but admins. */
  isActive?: boolean;

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

  // ── External booking hand-off (golf courses we don't run in-app) ──
  /** Direct online tee-time booking link on the course's own booking platform
   *  (foreUP / Chronogolf / GolfNow / etc.). Renders as the primary green
   *  "Book Tee Time" pill — the external sibling of the in-app `internalHref`
   *  hand-off. Omit for a course that only takes tee times by phone. */
  bookingUrl?: string;
  /** Label for the booking pill; defaults to "Book Tee Time". */
  bookingCta?: string;
  /** A rates/greens-fee page for a course that has no online tee-time booking.
   *  Renders as a distinct "See Rates" pill (accent-tinted icon, not the green
   *  Book pill). Use instead of `bookingUrl` for a rates-only course. */
  ratesUrl?: string;
  /** Label for the rates pill; defaults to "See Rates". */
  ratesCta?: string;
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
    // Rates-only: Edgewater publishes greens fees but has no online tee-time
    // booking, so this is a "See Rates" pill rather than a green Book one.
    ratesUrl: "https://edgewaterccgolf.com/rates",
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
    // Rates-only: "See Rates" points at Pinewood's site (where their own rates
    // live); it doubles as the site link, so no separate website pill here.
    ratesUrl: "https://www.pinewoodcc.com",
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
    bookingUrl: "https://merrill-golf-club.book.teeitup.com/?course=17053",
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
    bookingUrl: "https://www.chronogolf.com/club/19672/widget?medium=widget&source=club",
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
    bookingUrl: "https://foreupsoftware.com/index.php/booking/22872/12171#/teetimes",
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
    bookingUrl: "https://foreupsoftware.com/index.php/booking/19524/1784#/teetimes",
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
];

// ── DB (migration 0225) ──────────────────────────────────────────────────────

const ACCENTS: PlaceAccent[] = ["primary", "lake", "campfire", "sun", "dusk"];
const SITE_BUCKET = "site-assets";
const nn = (v: string | null | undefined): string | undefined => (v && v.trim() ? v : undefined);

export const KNOWN_GROUPS: Record<string, { title: string; emoji: string; accent: PlaceAccent }> = {
  golf: { title: "Golf", emoji: "⛳", accent: "primary" },
  food: { title: "Food & Drink", emoji: "🍔", accent: "campfire" },
  coffee: { title: "Coffee & Cafés", emoji: "☕", accent: "dusk" },
};
const GROUP_ORDER = ["golf", "food", "coffee"];

/** Section title for any group string ("pizza-places" -> "Pizza Places"). */
export function groupTitle(group: string): string {
  const known = KNOWN_GROUPS[group];
  if (known) return known.title;
  return group
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Group keys present in `places`: known ones first (golf, food, coffee), then
 *  the rest in first-seen order (the query is ordered by place_group). */
export function groupKeys(places: LocalPlace[]): string[] {
  const seen = Array.from(new Set(places.map((p) => p.group)));
  return [...GROUP_ORDER.filter((g) => seen.includes(g)), ...seen.filter((g) => !GROUP_ORDER.includes(g))];
}

export interface LocalPlaceRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  place_group: string;
  locality: string | null;
  address: string | null;
  blurb: string | null;
  emoji: string | null;
  accent: string;
  image_url: string | null;
  website: string | null;
  menu_url: string | null;
  order_url: string | null;
  phone_display: string | null;
  phone_tel: string | null;
  internal_href: string | null;
  internal_cta: string | null;
  booking_url: string | null;
  booking_cta: string | null;
  rates_url: string | null;
  rates_cta: string | null;
  position: number;
  is_active: boolean;
}

export function placeFromRow(r: LocalPlaceRow): LocalPlace {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category ?? "",
    locality: r.locality ?? "",
    blurb: r.blurb ?? "",
    emoji: r.emoji || "📍",
    accent: (ACCENTS as string[]).includes(r.accent) ? (r.accent as PlaceAccent) : "primary",
    group: r.place_group,
    address: nn(r.address),
    imageUrl: nn(r.image_url),
    website: nn(r.website),
    menuUrl: nn(r.menu_url),
    orderUrl: nn(r.order_url),
    phoneDisplay: nn(r.phone_display),
    phoneTel: nn(r.phone_tel),
    internalHref: nn(r.internal_href),
    internalCta: nn(r.internal_cta),
    bookingUrl: nn(r.booking_url),
    bookingCta: nn(r.booking_cta),
    ratesUrl: nn(r.rates_url),
    ratesCta: nn(r.rates_cta),
    position: r.position,
    isActive: r.is_active,
  };
}

/** Read the list. Falls back to the in-code PLACES ONLY when the read errors
 *  (no backend, table missing, offline) — an empty table is a real, empty list. */
export async function fetchLocalPlaces(): Promise<{ places: LocalPlace[]; fromDb: boolean }> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return { places: PLACES, fromDb: false };
  try {
    const { data, error } = await sb
      .from("local_places")
      .select("*")
      .order("place_group", { ascending: true })
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error || !data) return { places: PLACES, fromDb: false };
    return { places: (data as LocalPlaceRow[]).map(placeFromRow), fromDb: true };
  } catch {
    return { places: PLACES, fromDb: false };
  }
}

/** Editable fields as typed in the admin form (empty string = blank). */
export interface LocalPlaceInput {
  id?: string;
  slug: string;
  name: string;
  category: string;
  group: string;
  locality: string;
  address: string;
  blurb: string;
  emoji: string;
  accent: PlaceAccent;
  imageUrl: string;
  website: string;
  menuUrl: string;
  orderUrl: string;
  phoneDisplay: string;
  phoneTel: string;
  internalHref: string;
  internalCta: string;
  bookingUrl: string;
  bookingCta: string;
  ratesUrl: string;
  ratesCta: string;
  position: number;
  isActive: boolean;
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

/** "(715) 453-3130" / "715.453.3130" / "1-715-453-3130" -> "+17154533130".
 *  US default for 10 digits; an explicit "+" keeps its country code. Returns
 *  null when it can't be a valid number. */
export function normalizePhoneTel(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+17154533130" -> "(715) 453-3130" (US numbers); otherwise the E.164 itself. */
export function formatPhoneDisplay(tel: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(tel);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : tel;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** "Billy Bob's Pizza" -> "billy-bobs-pizza". */
export function slugifyPlace(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Validate + normalise the form. Returns an error string or the clean input. */
export function validateLocalPlace(i: LocalPlaceInput): { error: string } | { input: LocalPlaceInput } {
  const name = i.name.trim();
  if (!name) return { error: "A name is required." };
  const group = i.group.trim().toLowerCase();
  if (!group) return { error: "Pick a section." };
  for (const [label, v] of [
    ["Website", i.website],
    ["Menu link", i.menuUrl],
    ["Order link", i.orderUrl],
    ["Booking link", i.bookingUrl],
    ["Rates link", i.ratesUrl],
  ] as const) {
    if (v.trim() && !isHttpUrl(v)) return { error: `${label} must start with http:// or https://` };
  }
  let phoneTel = "";
  let phoneDisplay = i.phoneDisplay.trim();
  if (i.phoneTel.trim()) {
    const tel = normalizePhoneTel(i.phoneTel);
    if (!tel) return { error: "That phone number doesn't look right (10 digits, or +country code)." };
    phoneTel = tel;
    if (!phoneDisplay) phoneDisplay = formatPhoneDisplay(tel);
  }
  const slug = slugifyPlace(i.slug.trim() || name);
  if (!slug) return { error: "Couldn't make a short id from that name." };
  return { input: { ...i, name, group, slug, phoneTel, phoneDisplay } };
}

function toRow(i: LocalPlaceInput, uid: string | null) {
  return {
    slug: i.slug,
    name: i.name,
    category: orNull(i.category),
    place_group: i.group,
    locality: orNull(i.locality),
    address: orNull(i.address),
    blurb: orNull(i.blurb),
    emoji: orNull(i.emoji),
    accent: i.accent,
    image_url: orNull(i.imageUrl),
    website: orNull(i.website),
    menu_url: orNull(i.menuUrl),
    order_url: orNull(i.orderUrl),
    phone_display: orNull(i.phoneDisplay),
    phone_tel: orNull(i.phoneTel),
    internal_href: orNull(i.internalHref),
    internal_cta: orNull(i.internalCta),
    booking_url: orNull(i.bookingUrl),
    booking_cta: orNull(i.bookingCta),
    rates_url: orNull(i.ratesUrl),
    rates_cta: orNull(i.ratesCta),
    position: i.position,
    is_active: i.isActive,
    updated_by: uid,
  };
}

/** Insert (no id) or update (id) a place. Returns the real Postgres error text. */
export async function saveLocalPlace(input: LocalPlaceInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const v = validateLocalPlace(input);
  if ("error" in v) return { error: v.error };
  const uid = (await sb.auth.getUser()).data.user?.id ?? null;
  const row = toRow(v.input, uid);
  const { error } = v.input.id
    ? await sb.from("local_places").update(row).eq("id", v.input.id)
    : await sb.from("local_places").insert(row);
  if (!error) return {};
  return { error: error.code === "23505" ? "Another place already uses that short id." : error.message };
}

export async function deleteLocalPlace(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("local_places").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** Persist a new order: position = index within the given (single-group) id list. */
export async function saveLocalPlaceOrder(orderedIds: string[]): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  for (let idx = 0; idx < orderedIds.length; idx++) {
    const { error } = await sb.from("local_places").update({ position: idx }).eq("id", orderedIds[idx]);
    if (error) return { error: error.message };
  }
  return {};
}

/** Upload a place photo to the public `site-assets` bucket under `local-places/`
 *  (same approach as lib/appImages.ts uploadSiteImage) and return its URL. */
export async function uploadLocalPlaceImage(file: File): Promise<string> {
  const sb = supabase;
  if (!sb) throw new Error("Sign-in isn't available.");
  const compressed = await prepareImageForUpload(file);
  const path = `local-places/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage
    .from(SITE_BUCKET)
    .upload(path, compressed, { contentType: compressed.type || "image/jpeg", upsert: false });
  if (error) throw new Error(error.message);
  return sb.storage.from(SITE_BUCKET).getPublicUrl(path).data.publicUrl;
}
