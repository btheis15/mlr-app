/**
 * Small shared formatter library. Keep all display-formatting here so the
 * whole app reads dates/numbers/currency the same way (the same pattern the
 * Stock Game / Innjoy apps use).
 */

export function formatDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Long form, e.g. "Saturday, July 11". Accepts an ISO date string. */
export function formatDateLong(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(`${input}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Parses either a 24h "H:MM"/"HH:MM" string or a 12h "H:MM AM/PM" string
 * (the two formats this app's own time fields have ever produced). Returns
 * null rather than throwing/NaN-ing on anything else, so callers can fall
 * back gracefully instead of ever building an Invalid Date.
 */
function parseTimeParts(raw: string): { h: number; m: number } | null {
  const s = raw.trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2]);
    if (h < 1 || h > 12 || m > 59) return null;
    const isPm = ampm[3].toUpperCase() === "PM";
    h = h === 12 ? (isPm ? 12 : 0) : isPm ? h + 12 : h;
    return { h, m };
  }
  const plain = s.match(/^(\d{1,2}):(\d{2})$/);
  if (plain) {
    const h = Number(plain[1]);
    const m = Number(plain[2]);
    if (h > 23 || m > 59) return null;
    return { h, m };
  }
  return null;
}

/** "18:00" or "6:00 PM" → "6:00 PM". Never returns "Invalid Date" — anything
 *  it can't confidently parse is shown back as-typed instead. */
export function formatTime(input?: string): string {
  // Schedule items whose time isn't set yet read "TBD" rather than a fake slot.
  if (!input || !input.trim()) return "TBD";
  const parts = parseTimeParts(input);
  if (!parts) return input.trim();
  const d = new Date();
  d.setHours(parts.h, parts.m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Normalizes either time format to zero-padded 24h "HH:MM" for an
 *  `<input type="time">` value — "" (not "TBD") when unset/unparseable, since
 *  that's what the native time input expects for "no value". */
export function toTimeInputValue(input?: string | null): string {
  if (!input) return "";
  const parts = parseTimeParts(input);
  if (!parts) return "";
  return `${String(parts.h).padStart(2, "0")}:${String(parts.m).padStart(2, "0")}`;
}

/** "just now", "5m", "3h", "2d" — compact relative time for chat/announcements. */
export function timeAgo(input: string | number | Date): string {
  const then = input instanceof Date ? input.getTime() : new Date(input).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

/** Local "YYYY-MM-DD" key for grouping posts into days (not UTC). */
export function dayKey(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Timeline day header: "Today", "Yesterday", else "Saturday, July 27, 2026". */
export function formatDayHeading(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  const today = dayKey(new Date());
  const yest = dayKey(new Date(Date.now() - 86_400_000));
  const key = dayKey(d);
  if (key === today) return "Today";
  if (key === yest) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Local value for an <input type="datetime-local">, e.g. "2026-07-27T14:00". */
export function toDatetimeLocal(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Clock time from an ISO/Date, e.g. "2:00 PM". */
export function formatClock(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * A start–end date range, compact: "Jul 27" (single day), "Jul 27 – 31" (same
 * month), or "Jul 27 – Aug 1" (spanning). Accepts ISO "YYYY-MM-DD" strings,
 * parsed at local midnight to avoid a UTC off-by-one.
 */
export function formatDateRange(start: string, end?: string | null): string {
  const s = new Date(`${start}T00:00:00`);
  const left = s.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!end || end === start) return left;
  const e = new Date(`${end}T00:00:00`);
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const right = sameMonth
    ? e.toLocaleDateString(undefined, { day: "numeric" })
    : e.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}

/**
 * Friendly countdown from `today` to a future date (both ISO "YYYY-MM-DD"):
 * "Today", "Tomorrow", "in 5 days", "in 3 weeks", "in 2 months" — or null once
 * the date is in the past. Date-only, local-midnight parsed.
 */
export function relativeDays(today: string, date: string): string | null {
  const ms = new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime();
  const days = Math.round(ms / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/**
 * US phone helpers. The app assumes a "+1" country code (the family is all in
 * the States), so entry only deals in the 10 national digits and these turn
 * them into the friendly "(715) 555-0123" display.
 */

/** Strip a phone string to at most 10 US digits, dropping a leading "+1"/"1"
 *  country code so a pasted "+1 715…" or "1-715…" — and our own stored
 *  "+1 (715)…" value — all land on the 10 national digits we format.
 *
 *  The explicit "+1 " prefix is removed *textually first*: our stored value
 *  always carries it, and without this the prefix's own "1" gets re-counted as
 *  a national digit on every keystroke (the length-based strip below only fires
 *  once 11 digits accumulate), so a field would balloon into "(111) 111-1111"
 *  as you type. US national numbers never start with 1, so a leading 1 is
 *  unambiguously a country code either way. */
export function phoneDigits(input: string): string {
  const s = (input || "").replace(/^\s*\+1[\s.\-(]+/, "");
  let d = s.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
}

/** Progressive "(715) 555-0123" formatting of up-to-10 national digits — safe
 *  to call on partial input as someone types. */
export function formatPhoneNational(input: string): string {
  const d = phoneDigits(input);
  const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6, 10);
  if (!d) return "";
  if (d.length <= 3) return `(${a}`;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

/** Canonical stored phone with the assumed country code: "+1 (715) 555-0123",
 *  or "" when there are no digits. `tel:`/`sms:` links re-strip to digits, so
 *  this nicely-formatted value is also link-safe. */
export function formatPhoneStored(input: string): string {
  const national = formatPhoneNational(input);
  return national ? `+1 ${national}` : "";
}

/**
 * The right noun form for a count: `plural(1, "day")` → "day",
 * `plural(2, "day")` → "days". Pass `pluralForm` for irregulars
 * (e.g. `plural(n, "person", "people")`). Use as `{n} {plural(n, "day")}`.
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : pluralForm ?? `${singular}s`;
}

/**
 * Group an already-ordered list into consecutive runs that share a day key
 * (local "YYYY-MM-DD"), e.g. for day-separator headings in the feed/chat.
 * Keeps the input order; `getTs` pulls the timestamp out of each item.
 */
export function groupByDay<T>(items: T[], getTs: (item: T) => string | number | Date): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const k = dayKey(getTs(item));
    const last = groups[groups.length - 1];
    if (last && last.day === k) last.items.push(item);
    else groups.push({ day: k, items: [item] });
  }
  return groups;
}
