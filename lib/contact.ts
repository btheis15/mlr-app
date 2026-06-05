// A member's contact + pay info (the optional profile fields from migration
// 0006) and helpers that turn it into tappable actions for the member card.
// The member's `*_preferred` choice is floated to the front and flagged.

export interface MemberContact {
  phone?: string | null;
  contact_email?: string | null;
  venmo?: string | null;
  zelle?: string | null;
  cashapp?: string | null;
  paypal?: string | null;
  pay_preferred?: string | null;
  contact_preferred?: string | null;
  /** ISO date "YYYY-MM-DD" (migration 0020). Shown on the card with computed age. */
  birthday?: string | null;
  /** Free-text mailing address (migration 0020). Tap on the card → directions. */
  address?: string | null;
}

export interface Action {
  key: string;
  label: string;
  value: string; // the handle/number shown
  href?: string; // tappable link (tel:/sms:/mailto:/https); absent = copy-only
  note?: string;
  preferred?: boolean;
  brand?: string; // brand color → render as a smooth filled button (pay methods)
  emoji?: string; // leading emoji (contact methods)
  logo?: string; // leading logo image URL (pay methods)
}

const tel = (s: string) => s.replace(/[^\d+]/g, "");
const strip = (s: string, ch: string) => (s.startsWith(ch) ? s.slice(1) : s);
// Pay-method logos live on the mini (served at /assets) — off Supabase storage.
const ASSETS = (process.env.NEXT_PUBLIC_MEDIA_URL || "https://brians-mac-mini.tail49943c.ts.net").replace(/\/+$/, "") + "/assets";

export function contactActions(c: MemberContact): Action[] {
  const out: Action[] = [];
  if (c.phone) {
    out.push({ key: "text", label: "Text", value: c.phone, href: `sms:${tel(c.phone)}`, emoji: "💬" });
    out.push({ key: "call", label: "Call", value: c.phone, href: `tel:${tel(c.phone)}`, emoji: "📞" });
  }
  if (c.contact_email) out.push({ key: "email", label: "Email", value: c.contact_email, href: `mailto:${c.contact_email}`, emoji: "✉️" });
  return mark(out, c.contact_preferred);
}

export function payActions(c: MemberContact): Action[] {
  const out: Action[] = [];
  // venmo.com/<user>?txn=pay opens straight to the Pay screen (not the profile).
  if (c.venmo) out.push({ key: "venmo", label: "Venmo", value: `@${strip(c.venmo, "@")}`, href: `https://venmo.com/${strip(c.venmo, "@")}?txn=pay`, brand: "#008CFF", logo: `${ASSETS}/venmo.svg` });
  if (c.zelle) out.push({ key: "zelle", label: "Zelle", value: c.zelle, note: "send in your bank app", brand: "#6D1ED4", logo: `${ASSETS}/zelle.svg` });
  if (c.phone) out.push({ key: "applecash", label: "Apple Cash", value: c.phone, href: `sms:${tel(c.phone)}`, note: "send in Messages", brand: "#111111", logo: `${ASSETS}/applepay.svg` });
  if (c.cashapp) out.push({ key: "cashapp", label: "Cash App", value: `$${strip(c.cashapp, "$")}`, href: `https://cash.app/$${strip(c.cashapp, "$")}`, brand: "#00B843", logo: `${ASSETS}/cashapp.svg` });
  if (c.paypal) out.push({ key: "paypal", label: "PayPal", value: c.paypal, href: `https://paypal.me/${c.paypal.replace(/^https?:\/\/(www\.)?paypal\.me\//i, "")}`, brand: "#0070BA", logo: `${ASSETS}/paypal.svg` });
  return mark(out, c.pay_preferred);
}

// Float the preferred action to the front and flag it.
function mark(actions: Action[], preferred?: string | null): Action[] {
  const i = preferred ? actions.findIndex((a) => a.key === preferred) : -1;
  if (i < 0) return actions;
  actions[i].preferred = true;
  if (i > 0) {
    const [p] = actions.splice(i, 1);
    return [p, ...actions];
  }
  return actions;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** From a "YYYY-MM-DD" birthday → the month/day label + current age. Parses the
 *  parts directly (no Date(string), which would timezone-shift the day). */
export function birthdayInfo(birthday?: string | null): { date: string; age: number; isToday: boolean } | null {
  if (!birthday) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const now = new Date();
  const curMo = now.getMonth() + 1, curD = now.getDate();
  let age = now.getFullYear() - y;
  if (curMo < mo || (curMo === mo && curD < d)) age -= 1;
  return { date: `${MONTHS[mo - 1]} ${d}`, age, isToday: curMo === mo && curD === d };
}

/** Directions to an address in each major map app — let the member pick which to
 *  use. Apple Maps + Google Maps work on every platform (open the native app if
 *  installed, else the web map); Waze opens the Waze app or its web fallback. */
export function directionsLinks(address: string): { key: string; label: string; emoji: string; href: string }[] {
  const q = encodeURIComponent(address.trim());
  return [
    { key: "apple", label: "Apple Maps", emoji: "🗺️", href: `https://maps.apple.com/?daddr=${q}` },
    { key: "google", label: "Google Maps", emoji: "📍", href: `https://www.google.com/maps/dir/?api=1&destination=${q}` },
    { key: "waze", label: "Waze", emoji: "🚗", href: `https://waze.com/ul?q=${q}&navigate=yes` },
  ];
}
