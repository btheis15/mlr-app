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

/** "18:00" → "6:00 PM". Accepts an "HH:MM" 24h string. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
