/**
 * Small shared formatter library. Keep all display-formatting here so the
 * whole app reads dates/numbers/currency the same way (the same pattern the
 * Stock Game / Innjoy apps use).
 */

// Parse to a Date, treating a bare "YYYY-MM-DD" as LOCAL midnight. `new
// Date("YYYY-MM-DD")` is parsed as UTC, which lands on the PREVIOUS local day in
// western (negative-offset) timezones — so a day-key round-tripped back through
// `new Date()` shifts back a day, e.g. mislabeling today's chat messages as
// "Yesterday". Full ISO timestamps (with a time) and Dates pass through as-is.
function toLocalDate(input: string | number | Date): Date {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T00:00:00`);
  }
  return input instanceof Date ? input : new Date(input);
}

/**
 * Short form, e.g. "Fri, Jul 31". A bare "YYYY-MM-DD" is parsed at LOCAL
 * midnight (via `toLocalDate`) — `new Date("YYYY-MM-DD")` is parsed as UTC and
 * so renders the PREVIOUS day in any negative-offset zone, which is exactly
 * how a sign-up slot stored as 2026-07-31 came out labeled "Thu, Jul 30" all
 * over the fest UI while the server (correctly) fired its reminder on the
 * 31st. Callers that used to pre-append "T00:00:00" to dodge this are still
 * fine — a full ISO timestamp passes straight through.
 */
export function formatDate(input: string | number | Date): string {
  return toLocalDate(input).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Human byte size, e.g. "793.4 GB" / "206 MB" / "512 KB". Decimal units (÷1000,
 * GB not GiB) to match how macOS/Finder and drive-capacity labels report space,
 * so "999.8 GB" here lines up with what the drive is sold/shown as. One decimal
 * from GB up, whole numbers below.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let n = bytes;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  const decimals = i >= 3 ? 1 : 0; // one decimal at GB+, whole numbers for B/KB/MB
  return `${n.toFixed(decimals)} ${units[i]}`;
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

/** Minutes since midnight for a "HH:MM" (24h) or "H:MM AM/PM" time — used to
 *  SORT mixed schedule items (events + dinners) into one timeline. An unset or
 *  unparseable time (a "TBD" item) returns +Infinity so it sorts to the end. */
export function timeToMinutes(input?: string): number {
  if (!input || !input.trim()) return Number.POSITIVE_INFINITY;
  const parts = parseTimeParts(input);
  return parts ? parts.h * 60 + parts.m : Number.POSITIVE_INFINITY;
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

/** Like formatTime, but for a schedule event: an "Anytime all week" event
 *  (migration 0139) with no time set is a deliberate choice — there's no
 *  slot to decide, so it reads as "No specific time" rather than "TBD",
 *  which otherwise implies someone still needs to pin one down. A day-locked
 *  event with a missing time is the genuinely-still-pending case and keeps
 *  reading as "TBD". An anytime event with sign-up **time slots** turned on
 *  (migration 0135/0136) does have specific times to pick from — they just
 *  live in the sign-up card below, not on the event itself — so it reads as
 *  "Specific time slots" instead, pointing at where those times actually are. */
export function formatEventTime(event: {
  anytime?: boolean;
  start?: string;
  signupEnabled?: boolean;
  signupMode?: string | null;
}): string {
  if (!event.start || !event.start.trim()) {
    if (!event.anytime) return "TBD";
    return event.signupEnabled && event.signupMode !== "headcount" ? "Specific time slots" : "No specific time";
  }
  return formatTime(event.start);
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
  const d = toLocalDate(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Timeline day header: "Today", "Yesterday", else "Saturday, July 27, 2026". */
export function formatDayHeading(input: string | number | Date): string {
  const d = toLocalDate(input);
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
 * US dollars for the House Requests board (migration 0195) — the app's first
 * real currency display, so it lives here rather than inline (the "all
 * formatting goes through lib/format.ts" convention).
 *
 * Cents are dropped for a whole-dollar amount ("$40", not "$40.00") because
 * that's how a family writes a price, but KEPT whenever there's a real
 * fractional part ("$12.99") — rounding a stated cost would misreport it. A
 * null/blank amount renders as an em dash, never "$0", so "nobody said what it
 * costs" can't be mistaken for "it's free".
 */
export function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  const whole = Math.abs(amount % 1) < 0.005;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
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
