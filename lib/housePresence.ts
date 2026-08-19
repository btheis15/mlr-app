// Who will actually be AT a house, and when — the union of two very different
// signals, in one place because two features need the same answer:
//
//   1. `house_stays` (migration 0071) — somebody explicitly said "I'm going up
//      on these dates."
//   2. **An RSVP to a resort-wide event** — a member of the house marked "going"
//      to something happening at the resort.
//
// ⚠️⚠️ THE RULE, AND ITS DIRECTION. A square is a rectangle; a rectangle isn't
// always a square. **If you're in the house and you're going to a resort event,
// you're going to be at the house** — so you belong in "Who's staying", even if
// you're tenting or sleeping in one of the cabins. It does NOT run the other
// way: a house stay implies nothing about any event. Every derivation here is
// event → presence, never presence → event.
//
// Why this matters beyond the roster: the House Calendar was showing "No stays
// on the calendar yet" for MJT House while three of its members were RSVP'd
// "going" to the Fall Work Weekend. The house had a full weekend of people
// coming and the calendar said it was empty.
//
// Nothing here writes anything. An implied stay is DERIVED at read time and is
// never persisted — the moment someone adds a real stay, or changes their RSVP,
// the derived row updates or disappears on its own. Persisting these would mean
// inventing rows nobody typed, which then need reconciling forever.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { effectiveStatus, eventDays } from "@/lib/events";
import type { EventAttendance, HouseStay, ResortEvent } from "@/lib/types";

export interface HouseMember {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Somebody assigned to this house who has NO app account yet — a
 * `family_roster` slot with `house_id` set and nothing linked to it (0123).
 *
 * ⚠️ These people are first-class housemates, not a footnote. They can't RSVP
 * themselves (no account), but an admin or the event's host can add them to an
 * event's list (`add_event_attendee`, 0196 → `event_attendance.roster_id`), and
 * when that happens they are just as much "staying at the house" as anyone with
 * a login. Leaving them out is what made the MJT House calendar undercount:
 * Billy is assigned to the house and coming up, and the calendar didn't know he
 * existed because the derivation only looked at `profiles`.
 */
export interface HouseRosterMember {
  rosterId: string;
  name: string;
}

/**
 * Everyone whose profile says they're in this house.
 *
 * Reads `profiles` directly — members-readable, and `house_id` is what the whole
 * houses feature keys on — the same shape (and the same reasoning) as
 * `fetchHouseAdmins` in lib/houseRequests.ts. Empty on any failure: a presence
 * list that can't resolve membership must show nothing rather than guess.
 */
export async function fetchHouseMembers(houseId: string | null): Promise<HouseMember[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !houseId) return [];
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("house_id", houseId);
    if (error) return [];
    return ((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => ({
      id: p.id,
      name: p.display_name?.trim() || "Member",
      avatarUrl: p.avatar_url ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * The house's account-less people (0123). Only rows with nothing linked: once a
 * roster slot claims an account, that person is covered by `fetchHouseMembers`
 * via `profiles.house_id`, and returning them here too would list them twice.
 *
 * Empty on any failure — same reasoning as `fetchHouseMembers`: a presence list
 * that can't resolve membership must show nothing rather than guess.
 */
export async function fetchHouseRosterMembers(houseId: string | null): Promise<HouseRosterMember[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb || !houseId) return [];
  try {
    const { data, error } = await sb
      .from("family_roster")
      .select("id, name, linked_user_id")
      .eq("house_id", houseId);
    if (error) return [];
    return ((data ?? []) as { id: string; name: string | null; linked_user_id: string | null }[])
      .filter((r) => !r.linked_user_id)
      .map((r) => ({ rosterId: r.id, name: r.name?.trim() || "Family" }));
  } catch {
    return [];
  }
}

/**
 * A stay nobody typed: "<name> is going to <event>, so they'll be at the house."
 *
 * Deliberately NOT a `HouseStay`. It has no row in `house_stays`, so it can't be
 * edited, deleted or opened like one, and giving it that type would invite
 * exactly those affordances. The UI shows it as its own kind of row that taps
 * through to the EVENT — the thing that actually created it.
 */
export interface ImpliedStay {
  /** Stable synthetic key. Not a database id — never send it to an RPC. */
  id: string;
  /** Null for an account-less housemate or a sponsored guest — neither has one. */
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  /** The days they're actually expected, already narrowed by any per-day RSVP. */
  startDate: string;
  endDate: string;
  eventId: string;
  eventTitle: string;
  /**
   * How this person is attached to the house, which is what the row's label has
   * to say — three genuinely different situations that all mean "they'll be
   * here", and flattening them into one would make the list unreadable:
   *
   *  • `member`  — in the house, has an account, RSVP'd themselves.
   *  • `roster`  — assigned to the house but has no account yet (Billy). Added
   *                to the event by an admin or a host.
   *  • `guest`   — not family, but sponsored by someone in this house, so
   *                they're staying here too. `sponsorName` says who.
   */
  via: "member" | "roster" | "guest";
  /** For `guest` — the housemate vouching for them ("guest of Beth"). */
  sponsorName: string | null;
}

/** Do two inclusive ISO date ranges touch at all? (String compare is safe.) */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Derive "they'll be at the house" rows from event RSVPs.
 *
 * ⚠️ Four rules, each of which exists to stop a wrong or duplicate row:
 *
 *  1. **A real stay always wins.** If the member already has a `house_stays` row
 *     overlapping the event, no implied row is produced — they've stated their
 *     actual dates, which may be wider than the event (up Thursday for a Saturday
 *     work day), and showing both would list one person twice.
 *  2. **Per-day RSVPs are respected.** On a day-RSVP event (Family Fest), a
 *     member who marked only Mon–Wed is shown for Mon–Wed, not the whole week.
 *  3. **Only "going" counts** — via `effectiveStatus`, so a Maybe is never
 *     turned into a stay. Somebody who might come is not somebody who's staying.
 *  4. **Finished events are skipped.** This answers "who's coming", and
 *     back-filling implied history for every event the house ever attended would
 *     bury the real stays under years of derived rows.
 *
 * Pure — every input is already fetched by the caller (`useEvents` has the
 * events and attendance; `useHouseCalendar` has the stays), so this adds no
 * round-trip beyond the one membership read.
 */
export function impliedStays(args: {
  events: ResortEvent[];
  /** Every attendance row (`useEvents().rows`) — filtered to this house here. */
  attendance: EventAttendance[];
  members: HouseMember[];
  /** Account-less people assigned to this house (0123) — see the interface. */
  rosterMembers?: HouseRosterMember[];
  stays: HouseStay[];
  /** ISO today, from `useDemoDate()`. */
  today: string;
}): ImpliedStay[] {
  const { events, attendance, members, rosterMembers = [], stays, today } = args;
  if (!today) return [];
  // A house with neither kind of member can't place anybody.
  if (members.length === 0 && rosterMembers.length === 0) return [];

  const byId = new Map(members.map((m) => [m.id, m]));
  const byRosterId = new Map(rosterMembers.map((m) => [m.rosterId, m]));
  const out: ImpliedStay[] = [];

  for (const event of events) {
    // ⚠️ `endDate` is null/absent on a SINGLE-DAY event, so it can never be
    // compared or passed along raw — a bare `event.endDate < today` would treat
    // every one-day event as ongoing forever.
    const eventEnd = event.endDate ?? event.startDate;
    // Rule 4 — it's over; nobody is "about to be" there for it.
    if (eventEnd < today) continue;
    const days = eventDays(event.startDate, eventEnd);

    for (const row of attendance) {
      if (row.eventId !== event.id) continue;

      // ── Which of the three kinds of person is this row, and are they OURS? ──
      // This used to be `if (!row.userId) continue` — "no account, can't place
      // them" — which silently dropped two whole categories of people who are
      // just as much at the house: an account-less housemate added by a host
      // (0196's roster_id), and an outside guest sponsored by a housemate.
      let via: ImpliedStay["via"] | null = null;
      let name = "";
      let avatarUrl: string | null = null;
      let sponsorName: string | null = null;

      if (row.userId) {
        const member = byId.get(row.userId);
        if (member) {
          via = "member";
          name = member.name;
          avatarUrl = member.avatarUrl;
        }
      } else if (row.rosterId) {
        const rosterMember = byRosterId.get(row.rosterId);
        if (rosterMember) {
          via = "roster";
          name = rosterMember.name;
        }
      } else if (row.guestName?.trim() && row.sponsorUserId) {
        // A guest belongs to whoever vouched for them (0196 requires a sponsor
        // precisely so an outside guest is always traceable). If that sponsor is
        // in this house, the guest is staying in this house too.
        const sponsor = byId.get(row.sponsorUserId);
        if (sponsor) {
          via = "guest";
          name = row.guestName.trim();
          sponsorName = sponsor.name;
        }
      }
      if (!via) continue; // nothing ties this row to this house

      // Rule 3.
      if (effectiveStatus(row.status, row.days) !== "going") continue;

      // Rule 2 — narrow to the days they actually said yes to.
      const mine = row.days && Object.keys(row.days).length ? days.filter((d) => row.days![d] === "going") : days;
      if (mine.length === 0) continue;
      const startDate = mine[0];
      const endDate = mine[mine.length - 1];

      // Rule 1 — they've already told us their real dates. ⚠️ Only applies to a
      // row with an ACCOUNT: `house_stays.created_by` is a uuid, so there is no
      // real stay that could belong to a roster person or a guest, and matching
      // `createdBy === undefined` would suppress every one of them at once.
      const covered =
        Boolean(row.userId) &&
        stays.some((s) => s.createdBy === row.userId && overlaps(s.startDate, s.endDate, startDate, endDate));
      if (covered) continue;

      out.push({
        // ⚠️ Keyed on the attendance row's own id, not the user id — a guest row
        // has no user id, and two guests at one event would otherwise collide on
        // `event:<id>:undefined` and silently render as one person.
        id: `event:${event.id}:${row.id}`,
        userId: row.userId ?? null,
        name,
        avatarUrl,
        startDate,
        endDate,
        eventId: event.id,
        eventTitle: event.title,
        via,
        sponsorName,
      });
    }
  }

  // Soonest first, then by name — the same order the real-stay agenda uses.
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
}

/**
 * The next stretch of time somebody will be at the house — from a real stay OR
 * an implied one — with who and (if it came from an event) what for.
 *
 * This is the "is anyone going to be up there soon?" question, and it's what
 * makes an approved-but-unordered purchase actionable: something can be ordered
 * to ARRIVE while people are there to receive it.
 *
 * Counts a stretch that's already underway (`endDate >= today`), since somebody
 * being there right now is the strongest possible version of "somebody's there".
 */
export interface HousePresenceWindow {
  startDate: string;
  endDate: string;
  /** Names of everyone expected in this window, soonest-first order. */
  names: string[];
  /** Set when the window came from a resort event, for "in time for the …". */
  eventTitle: string | null;
  /** Whole days until it starts; 0 while it's happening. */
  daysUntil: number;
}

/** Calendar days between two ISO dates (UTC-safe — never `new Date("YYYY-MM-DD")`
 *  arithmetic against a local-midnight value; see the 0168 date-shift incident). */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function nextPresence(args: {
  stays: HouseStay[];
  implied: ImpliedStay[];
  today: string;
}): HousePresenceWindow | null {
  const { stays, implied, today } = args;
  if (!today) return null;

  type Item = { startDate: string; endDate: string; name: string; eventTitle: string | null };
  const items: Item[] = [
    ...stays
      .filter((s) => s.endDate >= today)
      .map((s) => ({ startDate: s.startDate, endDate: s.endDate, name: s.authorName, eventTitle: null })),
    ...implied
      .filter((i) => i.endDate >= today)
      .map((i) => ({ startDate: i.startDate, endDate: i.endDate, name: i.name, eventTitle: i.eventTitle })),
  ];
  if (items.length === 0) return null;

  items.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const first = items[0];
  // Everything that overlaps the first window is part of the same "people are
  // at the house" stretch — a work weekend is one occasion, not five rows.
  const group = items.filter((i) => overlaps(i.startDate, i.endDate, first.startDate, first.endDate));

  return {
    startDate: first.startDate,
    endDate: group.reduce((max, i) => (i.endDate > max ? i.endDate : max), first.endDate),
    names: Array.from(new Set(group.map((i) => i.name))),
    eventTitle: group.find((i) => i.eventTitle)?.eventTitle ?? null,
    daysUntil: Math.max(0, daysBetween(today, first.startDate)),
  };
}

/**
 * Everyone expected at the house on ONE day — real stays and implied ones
 * together.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE THE DAY POPOVER AND THE LIST BELOW IT DISAGREED. The
 * House Calendar's day detail counted only `house_stays`, so tapping Sep 25 said
 * **"STAYING (0) · Nobody's marked a stay for this day yet"** while "Who's
 * staying", three inches lower on the same screen, listed five people for Sep
 * 25–27. Both were reading the same data; only one of them knew that an RSVP to
 * a resort event counts as being at the house.
 *
 * So neither surface derives it any more — they both call this. If a third
 * surface ever needs "who's here on day X", it calls this too rather than
 * re-deriving and becoming the next one to disagree.
 */
export interface DayOccupant {
  /** Stable per-row key. */
  key: string;
  name: string;
  avatarUrl: string | null;
  /** Null for a real stay; set when the row came from an event RSVP. */
  eventTitle: string | null;
  /** Real `house_stays` row vs. derived — the UI marks them differently. */
  kind: "stay" | "implied";
  /** For a derived row: how they're attached to the house. */
  via: ImpliedStay["via"] | null;
  sponsorName: string | null;
  /** Extra names riding on a real stay (`house_stays.guest_names`). */
  guestNames: string[];
}

export function occupantsOnDay(args: {
  day: string;
  stays: HouseStay[];
  implied: ImpliedStay[];
}): DayOccupant[] {
  const { day, stays, implied } = args;
  if (!day) return [];

  const out: DayOccupant[] = [
    ...stays
      .filter((s) => s.startDate <= day && s.endDate >= day)
      .map((s) => ({
        key: `stay:${s.id}`,
        name: s.authorName,
        avatarUrl: s.authorAvatarUrl,
        eventTitle: null,
        kind: "stay" as const,
        via: null,
        sponsorName: null,
        guestNames: s.guestNames ?? [],
      })),
    ...implied
      .filter((i) => i.startDate <= day && i.endDate >= day)
      .map((i) => ({
        key: i.id,
        name: i.name,
        avatarUrl: i.avatarUrl,
        eventTitle: i.eventTitle,
        kind: "implied" as const,
        via: i.via,
        sponsorName: i.sponsorName,
        guestNames: [],
      })),
  ];
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How many people are expected at the house across everything upcoming — the
 * number on the "Who's staying" heading.
 *
 * ⚠️ Counts PEOPLE, not rows: a real stay's `guest_names` are extra people
 * sleeping there, so they're included, and one person appearing in both a stay
 * and an implied row (which Rule 1 mostly prevents, but not across differently
 * -dated events) is counted once. "Who's staying (5)" has to match what someone
 * gets if they count the names on screen.
 */
export function stayingCount(args: { stays: HouseStay[]; implied: ImpliedStay[] }): number {
  const { stays, implied } = args;
  const names = new Set<string>();
  for (const s of stays) {
    names.add(`p:${s.createdBy || s.authorName}`);
    for (const g of s.guestNames ?? []) if (g.trim()) names.add(`g:${g.trim().toLowerCase()}`);
  }
  for (const i of implied) {
    names.add(i.userId ? `p:${i.userId}` : `g:${i.name.trim().toLowerCase()}`);
  }
  return names.size;
}
