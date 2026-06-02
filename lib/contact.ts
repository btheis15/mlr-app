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
}

export interface Action {
  key: string;
  label: string;
  value: string; // the handle/number shown
  href?: string; // tappable link (tel:/sms:/mailto:/https); absent = copy-only
  note?: string;
  preferred?: boolean;
}

const tel = (s: string) => s.replace(/[^\d+]/g, "");
const strip = (s: string, ch: string) => (s.startsWith(ch) ? s.slice(1) : s);

export function contactActions(c: MemberContact): Action[] {
  const out: Action[] = [];
  if (c.phone) {
    out.push({ key: "text", label: "Text", value: c.phone, href: `sms:${tel(c.phone)}` });
    out.push({ key: "call", label: "Call", value: c.phone, href: `tel:${tel(c.phone)}` });
  }
  if (c.contact_email) out.push({ key: "email", label: "Email", value: c.contact_email, href: `mailto:${c.contact_email}` });
  return mark(out, c.contact_preferred);
}

export function payActions(c: MemberContact): Action[] {
  const out: Action[] = [];
  if (c.venmo) out.push({ key: "venmo", label: "Venmo", value: `@${strip(c.venmo, "@")}`, href: `https://venmo.com/u/${strip(c.venmo, "@")}` });
  if (c.zelle) out.push({ key: "zelle", label: "Zelle", value: c.zelle, note: "send in your bank app" });
  if (c.phone) out.push({ key: "applecash", label: "Apple Cash", value: c.phone, href: `sms:${tel(c.phone)}`, note: "send in Messages" });
  if (c.cashapp) out.push({ key: "cashapp", label: "Cash App", value: `$${strip(c.cashapp, "$")}`, href: `https://cash.app/$${strip(c.cashapp, "$")}` });
  if (c.paypal) out.push({ key: "paypal", label: "PayPal", value: c.paypal, href: `https://paypal.me/${c.paypal.replace(/^https?:\/\/(www\.)?paypal\.me\//i, "")}` });
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
