"use client";

import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";

const WINDOW_DAYS = 14;

interface Upcoming {
  id: string;
  name: string;
  daysUntil: number;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  full_name: string | null;
  birthday: string | null;
}

/**
 * Days from local midnight `today` to the next occurrence of a "YYYY-MM-DD"
 * birthday, year-agnostic (wraps to next year once this year's date has
 * passed). Feb-29 birthdays fall back to Feb 28 in a non-leap target year (so
 * they're never silently skipped) — mirrors media-server/birthday-notifier.js.
 * Returns null for an unparseable value.
 */
function daysUntilBirthday(birthday: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday.trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dayFor = (y: number) => (mo === 2 && d === 29 && !isLeap(y) ? 28 : d);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  let y = today.getFullYear();
  let next = new Date(y, mo - 1, dayFor(y)).getTime();
  if (next < t0) {
    y += 1;
    next = new Date(y, mo - 1, dayFor(y)).getTime();
  }
  return Math.round((next - t0) / 86_400_000);
}

/**
 * Members-only "birthdays in the next two weeks" strip. Reads
 * `profiles.birthday` (migration 0020) with a year-agnostic month/day compare
 * (local time); today's birthday(s) sort first and read "today! 🎉". Each name
 * deep-links to their contact card via the SAME `?member=` convention the
 * birthday push already uses (media-server/birthday-notifier.js →
 * components/MemberSheetHost.tsx) — a plain `<a>` (not next/link) so the
 * navigation is a real page load and MemberSheetHost's mount-time effect
 * actually fires and opens the sheet, even when tapped from Home itself (a
 * same-route query-only Next.js transition would not remount it). Null for
 * guests, and null (not an error) if the `birthday` column/table isn't
 * reachable yet or nobody's birthday falls in the window.
 *
 * Usage: `<BirthdaysCard />` — anywhere on Home, members-only (self-hides for
 * guests).
 */
/** Local-calendar YYYY-MM-DD, matching the card's local-midnight day math. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchUpcomingBirthdays(): Promise<Upcoming[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name, full_name, birthday")
    .not("birthday", "is", null);
  if (error || !data) return [];
  const today = new Date();
  const rows: Upcoming[] = [];
  for (const p of data as ProfileRow[]) {
    if (!p.birthday) continue;
    const daysUntil = daysUntilBirthday(p.birthday, today);
    if (daysUntil === null || daysUntil > WINDOW_DAYS) continue;
    const name = p.display_name?.trim() || p.full_name?.trim() || "Member";
    rows.push({ id: p.id, name, daysUntil });
  }
  rows.sort((a, b) => a.daysUntil - b.daysUntil);
  return rows;
}

export function BirthdaysCard() {
  const { user, userId } = useIdentity();
  // Shared SWR cache, date-scoped (`birthdays.<uid>.<today>`, 6h TTL): a cold
  // open paints the strip instantly; the date in the key means "in 3 days"
  // can never show a day late, and the revalidate picks up profile edits.
  const { data: upcoming } = useCachedResource<Upcoming[]>(
    user && userId ? `birthdays.${userId}.${localDayKey(new Date())}` : null,
    [],
    fetchUpcomingBirthdays,
    { persist: "local", ttlMs: 6 * 60 * 60 * 1000 },
  );

  if (!user || !upcoming.length) return null;

  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <p className="text-sm font-semibold">🎂 Upcoming Birthdays</p>
      <div className="mt-2 space-y-1">
        {upcoming.map((p) => (
          <a
            key={p.id}
            href={`/?member=${p.id}`}
            className="press -mx-1 flex items-center justify-between gap-2 rounded-lg px-1 py-1"
          >
            <span className="truncate text-sm">{p.name}</span>
            <span
              className={`shrink-0 text-xs ${p.daysUntil === 0 ? "font-semibold text-primary" : "text-foreground/60"}`}
            >
              {p.daysUntil === 0 ? "today! 🎉" : p.daysUntil === 1 ? "tomorrow" : `in ${p.daysUntil} days`}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
