// Family Fest content as shared, editable data (migration 0053). The schedule,
// dinners, payees, dues tiers, anytime activities, and the fest config all live
// in Supabase so app admins / Family Fest committee members can edit them in-app
// and BOTH the web app and iOS show the same thing. Reads are public (browse-
// first); writes are gated by RLS to `can_edit_fest()`. Everything degrades to
// the in-code seed (lib/data.ts) when there's no backend / a fetch is empty, so
// the page never breaks pre-migration or offline — the same fallback model as
// the iOS FestContentService and lib/events.ts.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { FAMILY_FEST, SCHEDULE, DINNERS, PAYEES, THINGS_TO_DO } from "@/lib/data";
import {
  fetchFestYears,
  currentFestYear as newestFestYear,
  SEED_FEST_YEAR,
  type FestYear,
} from "@/lib/festYears";
import { toISODate } from "@/lib/festSeason";
import { hexOrNull, type FestTheme } from "@/lib/festTheme";
import type {
  ScheduleEvent,
  Dinner,
  Payee,
  FestActivity,
  DuesTier,
  FestConfigContent,
  SignupField,
  EventLink,
} from "@/lib/types";

/**
 * The fest year every read and write here is keyed on. This used to be a
 * hardcoded `2026`, which meant a new fest needed a code change and a finished
 * one could never be set aside. It's now resolved from the data — the newest
 * `fest_config` row (see lib/festYears.ts) — and cached in module scope so the
 * write paths don't each pay a round-trip to look it up.
 *
 * `fetchFestContent()` refreshes it on every load, and `useFestContent`'s
 * Realtime subscription re-runs that load whenever `fest_config` changes, so an
 * open Planner starts writing to the new year within a tick of it being created
 * rather than at the next reload.
 *
 * The seed year is the pre-resolution fallback: with no backend (or before the
 * first fetch lands) writes still target the year the app shipped with, exactly
 * as the old constant did.
 */
let resolvedFestYear: number = SEED_FEST_YEAR.year;
/** Tracked separately from the value: the resolved year is usually EQUAL to the
 *  seed year, so comparing against the seed would make every write re-resolve. */
let festYearResolved = false;

/** The fest year the editing surfaces read and write. Resolves once if no
 *  content load has run yet (e.g. a Planner deep-link opened cold). */
async function activeFestYear(): Promise<number> {
  if (festYearResolved) return resolvedFestYear;
  const years = await fetchFestYears();
  resolvedFestYear = newestFestYear(years).year;
  festYearResolved = true;
  return resolvedFestYear;
}

// ── Fallbacks (the in-code seed; identical to the DB seed in migration 0053) ──

export const FALLBACK_CONFIG: FestConfigContent = {
  year: Number(FAMILY_FEST.startDate.slice(0, 4)),
  name: FAMILY_FEST.name,
  tagline: FAMILY_FEST.tagline,
  startDate: FAMILY_FEST.startDate,
  endDate: FAMILY_FEST.endDate,
  theme: FAMILY_FEST.theme,
  coverUrl: null,
  // Empty ⇒ the built-in `.ff-section` look, which is exactly what a
  // no-backend/first-paint render should show. See lib/festTheme.ts.
  look: {},
};

/** Seed dues tiers — all amounts TBD until set in the Planner. */
export const FALLBACK_DUES: DuesTier[] = [
  { id: "adult", label: "Adult (high school & up)", amount: null },
  { id: "kid", label: "Kid (K–8th grade)", amount: null },
  { id: "per-day", label: "Per day", amount: null, note: "per person", perDay: true },
  { id: "no-food", label: "Without food", amount: null, note: "per person" },
];

/** One action link on a call-out (migration 0093) — tel:… / mailto:… /
 *  https:…. A call-out can carry more than one (e.g. two separate order
 *  forms); each renders as its own line/button in CalloutCard so they read as
 *  distinctly separate actions. */
export interface CalloutLink {
  href: string;
  label: string | null;
}

/** A Home call-out card — a swipe-away StackItem above the permanent Family
 *  Fest spotlight (see HomeSpotlight/CalloutStack). Admin-managed rows in
 *  `home_callouts` (migration 0083, moved to Admin → Alerts & Notifications);
 *  `dismissId` is the CalloutStack session-dismissal key, versioned by editors
 *  so an updated card resurfaces. */
export interface HomeCallout {
  id: string;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  links: CalloutLink[];
  startsOn: string | null; // ISO date; null = show immediately
  endsOn: string | null; // ISO date, inclusive; null = open-ended
  dismissId: string;
  position: number;
  isActive: boolean;
  // Event targeting (migration 0096) — see lib/eventTargeting.ts. `eventId` is
  // a stable event id/slug (matches event_attendance.event_id); when set and
  // `excludeNotAttending` is true, HomeSpotlight hides this card from anyone
  // who explicitly RSVP'd "Can't make it" to that event.
  eventId: string | null;
  excludeNotAttending: boolean;
  /** Optional due-by timestamp (e.g. "order t-shirts by Friday 5pm") — distinct
   *  from startsOn/endsOn, which only gate when the card is shown. Reminder
   *  offsets (lib/scheduledBroadcasts.ts) are computed relative to this. */
  deadlineAt: string | null;
  /** Optional link to a schedule event's SIGN-UP (migration 0137). The
   *  fest_schedule_items id; the card renders a "Sign up" button deep-linking
   *  to /family-fest/schedule/<id>. Distinct from `eventId` (targeting only). */
  signupItemId: string | null;
  /** Optional link to a Drop Box folder (migration 0172). The `drop_boxes` id;
   *  the card renders a "Photos" button deep-linking to /drop?box=<id> so a
   *  callout can point straight at (e.g.) the Family Fest album. Distinct from
   *  `signupItemId` (a fest sign-up) and `eventId` (targeting only). */
  dropBoxId: string | null;
}

/** Seed call-outs — the t-shirt flyer this feature replaced, identical to the
 *  0083 seed row so Home looks the same whether or not the migration has run.
 *  Used only when the `home_callouts` table doesn't exist yet (pre-migration /
 *  no backend) — an empty table means "no call-outs", not "show the seed". */
export const FALLBACK_CALLOUTS: HomeCallout[] = [
  {
    id: "tshirt-order-jul15-2026",
    title: null,
    body: null,
    imageUrl: "/ff2026-tshirt-order.jpg",
    links: [{ href: "tel:7153653195", label: "📞 Call Tricia at Metro to order" }],
    startsOn: null,
    endsOn: "2026-07-15",
    dismissId: "tshirt-order-jul15-2026",
    position: 0,
    isActive: true,
    eventId: null,
    excludeNotAttending: false,
    deadlineAt: null,
    signupItemId: null,
    dropBoxId: null,
  },
];

/** Everything the Family Fest views need, in one bundle. */
export interface FestContent {
  config: FestConfigContent;
  schedule: ScheduleEvent[];
  dinners: Dinner[];
  payees: Payee[];
  activities: FestActivity[];
  dues: DuesTier[];
  callouts: HomeCallout[];
}

/** The in-code seed bundle — the first-paint value and the offline fallback. */
export const SEED_CONTENT: FestContent = {
  config: FALLBACK_CONFIG,
  schedule: SCHEDULE,
  dinners: DINNERS,
  payees: PAYEES,
  activities: THINGS_TO_DO,
  dues: FALLBACK_DUES,
  callouts: FALLBACK_CALLOUTS,
};

// ── Row shapes (snake_case, straight from Postgres) ───────────────────────────

// (No ConfigRow/mapConfig here any more — the config row now arrives already
// mapped, as the FestYear that named the year we're reading. See lib/festYears.ts.)
interface DuesRow {
  id: string;
  label: string;
  amount: number | null;
  note: string | null;
  per_day: boolean;
}
interface ScheduleRow {
  id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  emoji: string | null;
  location: string | null;
  description: string | null;
  bring: string | null;
  is_private: boolean;
  anytime: boolean;
  lead_user_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  crew_user_ids: string[] | null;
  image_url: string | null;
  links: EventLink[] | null;
  signup_enabled: boolean;
  signup_capacity: number | null;
  signup_slot_minutes: number | null;
  signup_start_time: string | null;
  signup_end_time: string | null;
  signup_mode: string | null;
  signup_instructions: string | null;
  signup_fields: SignupField[] | null;
  signup_reminder_minutes: number[] | null;
  signup_reminder_email: boolean | null;
  signup_team_size: number | null;
  tournament_enabled: boolean;
  signup_hide_names: boolean | null;
}
interface DinnerRow {
  id: string;
  day: string;
  title: string;
  emoji: string | null;
  chef_user_id: string | null;
  chef_name: string | null;
  chef_phone: string | null;
  crew_user_ids: string[] | null;
  houses: string[] | null;
  menu: string | null;
  served_time: string | null;
  served_location: string | null;
  prep_time: string | null;
  prep_location: string | null;
}
interface PayeeRow {
  id: string;
  name: string;
  role: string | null;
  venmo: string | null;
  zelle: string | null;
  applecash: string | null;
  paypal: string | null;
  note: string | null;
}
interface ActivityRow {
  id: string;
  title: string;
  emoji: string | null;
  blurb: string | null;
  details: string | null;
  location: string | null;
  lead_user_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  crew_user_ids: string[] | null;
  signup_enabled: boolean;
  signup_capacity: number | null;
  signup_slot_minutes: number | null;
  signup_start_time: string | null;
  signup_end_time: string | null;
  signup_mode: string | null;
  signup_instructions: string | null;
  signup_fields: SignupField[] | null;
  signup_reminder_minutes: number[] | null;
  signup_reminder_email: boolean | null;
}
interface CalloutRow {
  id: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  links: { href: string; label: string | null }[] | null;
  starts_on: string | null;
  ends_on: string | null;
  dismiss_id: string;
  position: number;
  is_active: boolean;
  event_id: string | null;
  exclude_not_attending: boolean;
  deadline_at: string | null;
  signup_item_id: string | null;
  drop_box_id: string | null;
}

const CALLOUT_COLUMNS =
  "id, title, body, image_url, links, starts_on, ends_on, dismiss_id, position, is_active, event_id, exclude_not_attending, deadline_at, signup_item_id, drop_box_id";

// ── Row → domain mappers (snake_case → the existing UI types) ─────────────────

function mapDues(r: DuesRow): DuesTier {
  return { id: r.id, label: r.label, amount: r.amount, note: r.note ?? undefined, perDay: r.per_day };
}
function mapSchedule(r: ScheduleRow): ScheduleEvent {
  return {
    id: r.id,
    day: r.day,
    start: r.start_time ?? undefined,
    end: r.end_time ?? undefined,
    title: r.title,
    location: r.location ?? "TBD",
    emoji: r.emoji ?? "🗓️",
    description: r.description ?? "",
    bring: r.bring ?? undefined,
    anytime: r.anytime ?? false,
    // We carry name + phone for the public card (tap-to-call/text); lead_user_id
    // is the link of record but the display fields stand on their own.
    lead: r.lead_name?.trim() ? { name: r.lead_name, phone: r.lead_phone ?? undefined } : undefined,
    leadUserId: r.lead_user_id,
    crewUserIds: r.crew_user_ids ?? [],
    imageUrl: r.image_url,
    links: r.links ?? [],
    signupEnabled: r.signup_enabled,
    signupCapacity: r.signup_capacity,
    signupSlotMinutes: r.signup_slot_minutes,
    signupStartTime: r.signup_start_time,
    signupEndTime: r.signup_end_time,
    signupMode: (r.signup_mode as "interval" | "slots" | "headcount" | null) ?? "interval",
    signupInstructions: r.signup_instructions,
    signupFields: r.signup_fields ?? [],
    signupReminderMinutes: r.signup_reminder_minutes ?? [],
    signupReminderEmail: r.signup_reminder_email ?? false,
    signupTeamSize: r.signup_team_size,
    tournamentEnabled: r.tournament_enabled ?? false,
    signupHideNames: r.signup_hide_names ?? false,
  };
}
function mapDinner(r: DinnerRow): Dinner {
  return {
    id: r.id,
    day: r.day,
    title: r.title,
    emoji: r.emoji ?? "🍽️",
    chef: { name: r.chef_name?.trim() || "TBD", phone: r.chef_phone ?? undefined },
    chefUserId: r.chef_user_id,
    crewUserIds: r.crew_user_ids ?? [],
    houses: r.houses ?? [],
    menu: r.menu ?? "TBD",
    time: r.served_time ?? "TBD",
    location: r.served_location ?? "TBD",
    prepTime: r.prep_time ?? "TBD",
    prepLocation: r.prep_location ?? undefined,
  };
}
function mapPayee(r: PayeeRow): Payee {
  return {
    id: r.id,
    name: r.name,
    role: r.role ?? "",
    venmo: r.venmo ?? undefined,
    zelle: r.zelle ?? undefined,
    applecash: r.applecash ?? undefined,
    paypal: r.paypal ?? undefined,
    note: r.note ?? undefined,
  };
}
function mapActivity(r: ActivityRow): FestActivity {
  return {
    id: r.id,
    title: r.title,
    emoji: r.emoji ?? "🗺️",
    blurb: r.blurb ?? "",
    details: r.details ?? undefined,
    location: r.location ?? undefined,
    lead: r.lead_name?.trim() ? { name: r.lead_name, phone: r.lead_phone ?? undefined } : undefined,
    leadUserId: r.lead_user_id,
    crewUserIds: r.crew_user_ids ?? [],
    signupEnabled: r.signup_enabled,
    signupCapacity: r.signup_capacity,
    signupSlotMinutes: r.signup_slot_minutes,
    signupStartTime: r.signup_start_time,
    signupEndTime: r.signup_end_time,
    signupMode: (r.signup_mode as "interval" | "slots" | null) ?? "interval",
    signupInstructions: r.signup_instructions,
    signupFields: r.signup_fields ?? [],
    signupReminderMinutes: r.signup_reminder_minutes ?? [],
    signupReminderEmail: r.signup_reminder_email ?? false,
  };
}
function mapCallout(r: CalloutRow): HomeCallout {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    imageUrl: r.image_url,
    links: Array.isArray(r.links) ? r.links : [],
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    dismissId: r.dismiss_id,
    position: r.position,
    isActive: r.is_active,
    eventId: r.event_id,
    excludeNotAttending: r.exclude_not_attending,
    deadlineAt: r.deadline_at,
    signupItemId: r.signup_item_id ?? null,
    dropBoxId: r.drop_box_id ?? null,
  };
}

// ── Reads (public; fall back to the seed on empty / error / no backend) ───────

/**
 * The CURRENT fest's content — what the hub, Home and the Planner all read.
 *
 * "Current" is resolved, not hardcoded: `fetchFestYears()` returns every
 * `fest_config` row and the newest one wins. That single query also *carries*
 * the config row, so naming the year costs nothing — it replaces the old
 * fest_config-by-year lookup instead of adding a round-trip to it. Resolving
 * here (rather than in a separate hook) also keeps the write paths honest: this
 * is what refreshes `resolvedFestYear`, and `useFestContent`'s Realtime
 * subscription re-runs it whenever `fest_config` changes.
 */
export async function fetchFestContent(): Promise<FestContent> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return SEED_CONTENT;
  try {
    const current = newestFestYear(await fetchFestYears());
    resolvedFestYear = current.year;
    festYearResolved = true;
    return await fetchYearContent(current, {
      callouts: true,
      // ⚠️ Only the SEED YEAR may be backfilled from the in-code seed. See
      // fetchYearContent.
      seedEmpty: current.year === SEED_FEST_YEAR.year,
    });
  } catch {
    return SEED_CONTENT;
  }
}

/**
 * One SPECIFIC year's content, for the Past Years archive
 * (/family-fest/past/[year]). Same reads as the hub, with two differences that
 * matter for an archive:
 *
 *  - **No seed fallback.** The hub backfills an empty table with the in-code
 *    2026 seed so it's never blank; an archive must not, or a year with no
 *    schedule rows would quietly display 2026's week as its own history.
 *  - **No call-outs.** `home_callouts` isn't year-scoped and is a live "act on
 *    this now" surface — meaningless on a finished fest.
 *
 * Returns null when that year has no config row at all (an unknown /past/1999),
 * so the page can say so instead of rendering an empty week.
 */
export async function fetchFestContentForYear(year: number): Promise<FestContent | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) {
    // No backend: the one year we can still honestly show is the seed year.
    return year === SEED_FEST_YEAR.year ? SEED_CONTENT : null;
  }
  try {
    const match = (await fetchFestYears()).find((y) => y.year === year);
    if (!match) return null;
    return await fetchYearContent(match, { callouts: false, seedEmpty: false });
  } catch {
    return null;
  }
}

/**
 * The shared read for one fest year.
 *
 * The two flags used to be one (`seed`), which conflated two unrelated things
 * and produced a real bug once there was more than one fest on record:
 *
 *  - `callouts` — whether to load `home_callouts`. Those aren't year-scoped and
 *    are a live "act on this now" surface, so only the current year wants them.
 *  - `seedEmpty` — whether an EMPTY table should be backfilled from the in-code
 *    seed in lib/data.ts. ⚠️ That seed is not generic filler: it *is* the 2026
 *    week, with 2026 dates. Backfilling any current year with it meant a
 *    brand-new fest with no schedule of its own rendered 2026's — "Ye Olde
 *    Family Faire", "Gene Pool Concert", under day cards reading July 26–30 —
 *    on the 2027 hub, and deleting them in the Planner only made them come
 *    back, because they were never rows. Same for its dues, payees and anytime
 *    activities. So the backfill is now scoped to the SEED YEAR itself, which is
 *    the only year the seed honestly describes; for anyone else, empty is empty.
 *
 * This is the mirror of the guard `fetchFestContentForYear` already had: an
 * archive must not fabricate history, and a new year must not inherit it.
 */
async function fetchYearContent(
  y: FestYear,
  { callouts: wantCallouts, seedEmpty }: { callouts: boolean; seedEmpty: boolean },
): Promise<FestContent> {
  const sb = supabase;
  if (!sb) return SEED_CONTENT;
  const year = y.year;
  const [dues, schedule, dinners, payees, activities, callouts] = await Promise.all([
    sb.from("fest_dues").select("id, label, amount, note, per_day").eq("fest_year", year).order("position"),
    sb
      .from("fest_schedule_items")
      .select(
        "id, day, start_time, end_time, title, emoji, location, description, bring, is_private, anytime, lead_user_id, lead_name, lead_phone, crew_user_ids, image_url, links, signup_enabled, signup_capacity, signup_slot_minutes, signup_start_time, signup_end_time, signup_mode, signup_instructions, signup_fields, signup_reminder_minutes, signup_reminder_email, signup_team_size, tournament_enabled, signup_hide_names",
      )
      .eq("fest_year", year)
      .order("day")
      .order("position"),
    sb
      .from("fest_dinners")
      .select(
        "id, day, title, emoji, chef_user_id, chef_name, chef_phone, crew_user_ids, houses, menu, served_time, served_location, prep_time, prep_location",
      )
      .eq("fest_year", year)
      .order("day")
      .order("position"),
    sb.from("fest_payees").select("id, name, role, venmo, zelle, applecash, paypal, note").eq("fest_year", year).order("position"),
    sb
      .from("fest_activities")
      .select("id, title, emoji, blurb, details, location, lead_user_id, lead_name, lead_phone, crew_user_ids, signup_enabled, signup_capacity, signup_slot_minutes, signup_start_time, signup_end_time, signup_mode, signup_instructions, signup_fields, signup_reminder_minutes, signup_reminder_email")
      .eq("fest_year", year)
      .order("position"),
    wantCallouts
      ? sb.from("home_callouts").select(CALLOUT_COLUMNS).order("position")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const scheduleRows = (schedule.data ?? []) as ScheduleRow[];
  const dinnerRows = (dinners.data ?? []) as DinnerRow[];
  const payeeRows = (payees.data ?? []) as PayeeRow[];
  const activityRows = (activities.data ?? []) as ActivityRow[];
  const duesRows = (dues.data ?? []) as DuesRow[];
  const calloutRows = (callouts.data ?? []) as CalloutRow[];

  return {
    // The config comes from the years list we already loaded, not a second
    // fest_config read.
    config: {
      year: y.year,
      name: y.name,
      tagline: y.tagline,
      startDate: y.startDate,
      endDate: y.endDate,
      theme: y.theme,
      coverUrl: y.coverUrl,
      look: y.look,
    },
    // Empty table ⇒ keep the in-code seed, but ONLY for the year that seed
    // actually describes (see seedEmpty above). Any other year renders empty.
    schedule: scheduleRows.length ? scheduleRows.map(mapSchedule) : seedEmpty ? SCHEDULE : [],
    dinners: dinnerRows.length ? dinnerRows.map(mapDinner) : seedEmpty ? DINNERS : [],
    payees: payeeRows.length ? payeeRows.map(mapPayee) : seedEmpty ? PAYEES : [],
    activities: activityRows.length ? activityRows.map(mapActivity) : seedEmpty ? THINGS_TO_DO : [],
    dues: duesRows.length ? duesRows.map(mapDues) : seedEmpty ? FALLBACK_DUES : [],
    // Call-outs degrade on ERROR only (pre-0083 the table doesn't exist —
    // show the in-code t-shirt seed so Home is unchanged). An EMPTY table is
    // a real state ("no call-outs"): the seed must not resurrect a card an
    // editor deliberately deleted.
    callouts: !wantCallouts ? [] : callouts.error ? FALLBACK_CALLOUTS : calloutRows.map(mapCallout),
  };
}

/** A short dues blurb for the Home/hub call-outs, e.g. "$100 / adult" — prefers
 *  the Adult tier, else the first tier with a set amount, else nudges to tap. */
export function duesSummary(dues: DuesTier[]): string {
  const adult = dues.find((d) => /adult/i.test(d.label) && d.amount != null);
  if (adult) return `$${adult.amount} / adult`;
  const first = dues.find((d) => d.amount != null);
  if (first) return `$${first.amount} · ${first.label}`;
  return "Tap to see amounts";
}

/** Whether the signed-in member may edit fest content (admin OR family-fest
 *  committee). Mirrors the iOS `canEditFest()` RPC call. False with no backend. */
export async function canEditFest(): Promise<boolean> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return false;
  try {
    const { data, error } = await sb.rpc("can_edit_fest");
    return !error && Boolean(data);
  } catch {
    return false;
  }
}

// ── Writes (RLS-gated to can_edit_fest()). Each returns { error? }. ───────────
// New rows (no id) insert with a DB-generated uuid; an id present ⇒ update.

async function currentUid(): Promise<string | null> {
  const sb = supabase;
  if (!sb) return null;
  // Read the uid from the LOCAL session, not auth.getUser() — getUser() makes a
  // network round-trip to the auth server that can stall on a flaky/blocked
  // mobile connection, hanging every fest write (the "Saving…" button never
  // resolves) even though reads work off the cached session. `updated_by` is
  // just an audit stamp (RLS is the real gate), so the local session is fine.
  return (await sb.auth.getSession()).data.session?.user?.id ?? null;
}

/** Write a row to one fest table — insert when `id` is absent, else update.
 *  Returns the row's id on success (the new uuid on insert, the given id on
 *  update) so a caller can attach child rows to a just-created parent. */
async function writeRow(
  table: string,
  id: string | undefined,
  row: Record<string, unknown>,
): Promise<{ error?: string; id?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const payload = { ...row, fest_year: await activeFestYear(), updated_at: new Date().toISOString(), updated_by: await currentUid() };
  if (id) {
    const { error } = await sb.from(table).update(payload).eq("id", id);
    return error ? { error: error.message } : { id };
  }
  const { data, error } = await sb.from(table).insert(payload).select("id").single();
  return error ? { error: error.message } : { id: (data as { id: string } | null)?.id };
}

async function deleteRow(table: string, id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from(table).delete().eq("id", id);
  return error ? { error: error.message } : {};
}

// Inputs use null (not undefined) for "clear this column" so updates blank fields.

export interface ScheduleInput {
  id?: string;
  day: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  emoji: string | null;
  location: string | null;
  description: string | null;
  bring: string | null;
  isPrivate: boolean;
  anytime: boolean;
  leadUserId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  crewUserIds: string[];
  position: number;
  imageUrl: string | null;
  links: EventLink[];
  signupEnabled: boolean;
  signupCapacity: number | null;
  signupSlotMinutes: number | null;
  signupStartTime: string | null;
  signupEndTime: string | null;
  signupMode: "interval" | "slots" | "headcount";
  signupInstructions: string | null;
  signupFields: SignupField[];
  signupReminderMinutes: number[];
  signupReminderEmail: boolean;
  signupTeamSize: number | null;
  tournamentEnabled: boolean;
  signupHideNames: boolean;
}
export const saveScheduleItem = (i: ScheduleInput) =>
  writeRow("fest_schedule_items", i.id, {
    day: i.day,
    start_time: i.startTime,
    end_time: i.endTime,
    title: i.title,
    emoji: i.emoji,
    location: i.location,
    description: i.description,
    bring: i.bring,
    is_private: i.isPrivate,
    anytime: i.anytime,
    lead_user_id: i.leadUserId,
    lead_name: i.leadName,
    lead_phone: i.leadPhone,
    crew_user_ids: i.crewUserIds,
    position: i.position,
    image_url: i.imageUrl,
    links: i.links,
    signup_enabled: i.signupEnabled,
    signup_capacity: i.signupCapacity,
    signup_slot_minutes: i.signupSlotMinutes,
    signup_start_time: i.signupStartTime,
    signup_end_time: i.signupEndTime,
    signup_mode: i.signupMode,
    signup_instructions: i.signupInstructions,
    signup_fields: i.signupFields,
    signup_reminder_minutes: i.signupReminderMinutes,
    signup_reminder_email: i.signupReminderEmail,
    signup_team_size: i.signupTeamSize,
    tournament_enabled: i.tournamentEnabled,
    signup_hide_names: i.signupHideNames,
  });
export const deleteScheduleItem = (id: string) => deleteRow("fest_schedule_items", id);

/** The subset of a schedule event a lead/crew member (not necessarily a fest
 *  admin/committee member) can self-edit — see migration 0110, mirroring
 *  DinnerDetailsInput/updateDinnerDetails. Deliberately narrower than
 *  ScheduleInput: day/title/time/private/lead/crew stay admin/committee-
 *  managed; this is just the on-the-ground details for the event you're
 *  running. RLS (lead_user_id / crew_user_ids match) is what actually
 *  authorizes it. */
export interface ScheduleDetailsInput {
  location: string | null;
  description: string | null;
  bring: string | null;
  links: EventLink[];
}
export async function updateScheduleDetails(id: string, i: ScheduleDetailsInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb
    .from("fest_schedule_items")
    .update({
      location: i.location,
      description: i.description,
      bring: i.bring,
      links: i.links,
      updated_at: new Date().toISOString(),
      updated_by: await currentUid(),
    })
    .eq("id", id);
  return error ? { error: error.message } : {};
}

export interface DinnerInput {
  id?: string;
  day: string;
  title: string;
  emoji: string | null;
  chefUserId: string | null;
  chefName: string | null;
  chefPhone: string | null;
  crewUserIds: string[];
  houses: string[];
  menu: string | null;
  servedTime: string | null;
  servedLocation: string | null;
  prepTime: string | null;
  prepLocation: string | null;
  position: number;
}
export const saveDinner = (i: DinnerInput) =>
  writeRow("fest_dinners", i.id, {
    day: i.day,
    title: i.title,
    emoji: i.emoji,
    chef_user_id: i.chefUserId,
    chef_name: i.chefName,
    chef_phone: i.chefPhone,
    crew_user_ids: i.crewUserIds,
    houses: i.houses,
    menu: i.menu,
    served_time: i.servedTime,
    served_location: i.servedLocation,
    prep_time: i.prepTime,
    prep_location: i.prepLocation,
    position: i.position,
  });
export const deleteDinner = (id: string) => deleteRow("fest_dinners", id);

/** The subset of a dinner a chef/crew member (not necessarily a fest
 *  admin/committee member) can self-edit — see migration 0099. Deliberately
 *  narrower than DinnerInput: day/title/emoji/chef/crew/houses stay
 *  admin/committee-managed; this is just "the operational details for the
 *  day you're actually cooking." A plain partial update (not writeRow, which
 *  always writes every DinnerInput field — this surface never has most of
 *  them, e.g. `position`). RLS (chef_user_id / crew_user_ids match) is what
 *  actually authorizes it. */
export interface DinnerDetailsInput {
  menu: string | null;
  servedTime: string | null;
  servedLocation: string | null;
  prepTime: string | null;
  prepLocation: string | null;
}
export async function updateDinnerDetails(id: string, i: DinnerDetailsInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb
    .from("fest_dinners")
    .update({
      menu: i.menu,
      served_time: i.servedTime,
      served_location: i.servedLocation,
      prep_time: i.prepTime,
      prep_location: i.prepLocation,
      updated_at: new Date().toISOString(),
      updated_by: await currentUid(),
    })
    .eq("id", id);
  return error ? { error: error.message } : {};
}

export interface PayeeInput {
  id?: string;
  name: string;
  role: string | null;
  venmo: string | null;
  zelle: string | null;
  applecash: string | null;
  paypal: string | null;
  note: string | null;
  position: number;
}
export const savePayee = (i: PayeeInput) =>
  writeRow("fest_payees", i.id, {
    name: i.name,
    role: i.role,
    venmo: i.venmo,
    zelle: i.zelle,
    applecash: i.applecash,
    paypal: i.paypal,
    note: i.note,
    position: i.position,
  });
export const deletePayee = (id: string) => deleteRow("fest_payees", id);

export interface DuesInput {
  id?: string;
  label: string;
  amount: number | null;
  note: string | null;
  perDay: boolean;
  position: number;
}
export const saveDuesTier = (i: DuesInput) =>
  writeRow("fest_dues", i.id, {
    label: i.label,
    amount: i.amount,
    note: i.note,
    per_day: i.perDay,
    position: i.position,
  });
export const deleteDuesTier = (id: string) => deleteRow("fest_dues", id);

export interface ActivityInput {
  id?: string;
  title: string;
  emoji: string | null;
  blurb: string | null;
  details: string | null;
  location: string | null;
  leadUserId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  crewUserIds: string[];
  position: number;
  signupEnabled: boolean;
  signupCapacity: number | null;
  signupSlotMinutes: number | null;
  signupStartTime: string | null;
  signupEndTime: string | null;
  signupMode: "interval" | "slots";
  signupInstructions: string | null;
  signupFields: SignupField[];
  signupReminderMinutes: number[];
  signupReminderEmail: boolean;
}
export const saveActivity = (i: ActivityInput) =>
  writeRow("fest_activities", i.id, {
    title: i.title,
    emoji: i.emoji,
    blurb: i.blurb,
    details: i.details,
    location: i.location,
    lead_user_id: i.leadUserId,
    lead_name: i.leadName,
    lead_phone: i.leadPhone,
    crew_user_ids: i.crewUserIds,
    position: i.position,
    signup_enabled: i.signupEnabled,
    signup_capacity: i.signupCapacity,
    signup_slot_minutes: i.signupSlotMinutes,
    signup_start_time: i.signupStartTime,
    signup_end_time: i.signupEndTime,
    signup_mode: i.signupMode,
    signup_instructions: i.signupInstructions,
    signup_fields: i.signupFields,
    signup_reminder_minutes: i.signupReminderMinutes,
    signup_reminder_email: i.signupReminderEmail,
  });
export const deleteActivity = (id: string) => deleteRow("fest_activities", id);

/** The subset of an activity a lead/crew member (not necessarily a fest
 *  admin/committee member) can self-edit — mirrors ScheduleDetailsInput.
 *  Deliberately narrower than ActivityInput: title/lead/crew stay
 *  admin/committee-managed. RLS (lead_user_id / crew_user_ids match) is what
 *  actually authorizes it. */
export interface ActivityDetailsInput {
  blurb: string | null;
  details: string | null;
  location: string | null;
}
export async function updateActivityDetails(id: string, i: ActivityDetailsInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb
    .from("fest_activities")
    .update({
      blurb: i.blurb,
      details: i.details,
      location: i.location,
      updated_at: new Date().toISOString(),
      updated_by: await currentUid(),
    })
    .eq("id", id);
  return error ? { error: error.message } : {};
}

// Home call-outs (migration 0083) — not year-keyed like the fest tables, so
// these write directly instead of through writeRow (which stamps fest_year).

export interface CalloutInput {
  id?: string;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  links: CalloutLink[];
  startsOn: string | null;
  endsOn: string | null;
  dismissId: string;
  position: number;
  isActive: boolean;
  eventId: string | null;
  excludeNotAttending: boolean;
  deadlineAt: string | null;
  signupItemId: string | null;
  dropBoxId: string | null;
}
export async function saveCallout(i: CalloutInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const row = {
    title: i.title,
    body: i.body,
    image_url: i.imageUrl,
    links: i.links,
    starts_on: i.startsOn,
    ends_on: i.endsOn,
    dismiss_id: i.dismissId,
    position: i.position,
    is_active: i.isActive,
    event_id: i.eventId,
    exclude_not_attending: i.excludeNotAttending,
    deadline_at: i.deadlineAt,
    signup_item_id: i.signupItemId,
    drop_box_id: i.dropBoxId,
  };
  // Resolve the insert's created_by up front (currentUid is async), then run
  // the write. `run` stays sync-shaped so the pre-migration retry is trivial.
  const created_by = i.id ? undefined : await currentUid();
  const run = (r: Record<string, unknown>) =>
    i.id ? sb.from("home_callouts").update(r).eq("id", i.id) : sb.from("home_callouts").insert({ ...r, created_by });
  let { error } = await run(row);
  // Pre-migration (0172 not yet applied): drop_box_id doesn't exist. Retry
  // without it so callout editing keeps working — the same graceful-degrade
  // idiom used across the DB layer (a missing new column never hard-breaks).
  if (error && /drop_box_id/.test(error.message || "")) {
    const { drop_box_id: _omit, ...base } = row;
    ({ error } = await run(base));
  }
  return error ? { error: error.message } : {};
}
export const deleteCallout = (id: string) => deleteRow("home_callouts", id);

/** All call-out rows (active or not) for the Planner's list. Empty with no
 *  backend or pre-0083 (the editor shows nothing to edit until the table exists). */
export async function fetchCallouts(): Promise<HomeCallout[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data } = await sb.from("home_callouts").select(CALLOUT_COLUMNS).order("position");
    return ((data ?? []) as CalloutRow[]).map(mapCallout);
  } catch {
    return [];
  }
}

export interface ConfigInput {
  name: string;
  tagline: string | null;
  startDate: string;
  endDate: string;
  /** This year's theme/title line (migration 0219). Null clears it. */
  theme: string | null;
}
/** Save the CURRENT fest year's config. Keyed by fest_year (upsert), so there's
 *  exactly one row per fest — editing dates here reshapes that year's week, it
 *  doesn't create a new one (see startFestYear for that). */
export async function saveConfig(i: ConfigInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("fest_config").upsert(
    {
      fest_year: await activeFestYear(),
      name: i.name,
      tagline: i.tagline,
      start_date: i.startDate,
      end_date: i.endDate,
      theme: i.theme,
      updated_at: new Date().toISOString(),
      updated_by: await currentUid(),
    },
    { onConflict: "fest_year" },
  );
  return error ? { error: error.message } : {};
}

/**
 * Save the CURRENT fest year's LOOK — palette, background, font (migration
 * 0219).
 *
 * An UPDATE, not an upsert: the row always exists by the time anyone is picking
 * colours for it (it's created by `startFestYear`, or seeded), and an upsert
 * that missed would invent a fest_config row with no name and no dates — which
 * `currentFestYear()` would then hand the hub as the newest year.
 *
 * ⚠️ Writes NULL for anything unset rather than omitting the key, so "reset to
 * the built-in look" is expressible. Null is the meaningful value here (see
 * lib/festTheme.ts): it's what keeps the stylesheet as the single source of
 * truth for the default, so a year using the default look genuinely has no
 * colours of its own to go stale.
 */
export async function saveFestLook(look: FestTheme): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb
    .from("fest_config")
    .update({
      theme_primary: hexOrNull(look.primary),
      theme_accent: hexOrNull(look.accent),
      theme_background: hexOrNull(look.background),
      theme_card: hexOrNull(look.card),
      theme_border: hexOrNull(look.border),
      theme_ink: hexOrNull(look.ink),
      theme_bg_style: look.bgStyle ?? null,
      theme_bg_image_url: look.bgImageUrl?.trim() || null,
      theme_bg_image_mode: look.bgImageMode ?? null,
      theme_bg_image_opacity: typeof look.bgImageOpacity === "number" ? look.bgImageOpacity : null,
      theme_font: look.font ?? null,
      updated_at: new Date().toISOString(),
      updated_by: await currentUid(),
    })
    .eq("fest_year", await activeFestYear());
  return error ? { error: error.message } : {};
}

/** Set (or clear, with null) the CURRENT year's cover photo. Per-year since
 *  0219 — it used to be the single app-wide `app_images.fest_cover`, so a new
 *  poster silently replaced the one the previous year's archive showed. */
export async function saveFestCover(url: string | null): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb
    .from("fest_config")
    .update({
      cover_url: url?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: await currentUid(),
    })
    .eq("fest_year", await activeFestYear());
  return error ? { error: error.message } : {};
}

// ── Editable drafts (raw rows incl. position / is_private / lead links) ───────
// The display mappers above drop edit-only fields; the Planner needs them, so it
// loads these full drafts. Each is the matching *Input plus its id + display
// helpers the list rows render.

export type ScheduleDraft = Required<Pick<ScheduleInput, "id">> & ScheduleInput;
export type DinnerDraft = Required<Pick<DinnerInput, "id">> & DinnerInput;
export type PayeeDraft = Required<Pick<PayeeInput, "id">> & PayeeInput;
export type DuesDraft = Required<Pick<DuesInput, "id">> & DuesInput;
export type ActivityDraft = Required<Pick<ActivityInput, "id">> & ActivityInput;

interface ScheduleDraftRow extends ScheduleRow {
  position: number;
}
interface DinnerDraftRow extends DinnerRow {
  position: number;
}
interface PayeeDraftRow extends PayeeRow {
  position: number;
}
interface DuesDraftRow extends DuesRow {
  position: number;
}
interface ActivityDraftRow extends ActivityRow {
  position: number;
}

export async function fetchScheduleDrafts(): Promise<ScheduleDraft[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_schedule_items")
    .select(
      "id, day, start_time, end_time, title, emoji, location, description, bring, is_private, anytime, lead_user_id, lead_name, lead_phone, crew_user_ids, position, image_url, links, signup_enabled, signup_capacity, signup_slot_minutes, signup_start_time, signup_end_time, signup_mode, signup_instructions, signup_fields, signup_reminder_minutes, signup_reminder_email, signup_team_size, tournament_enabled, signup_hide_names",
    )
    .eq("fest_year", await activeFestYear())
    .order("day")
    .order("position");
  return ((data ?? []) as ScheduleDraftRow[]).map((r) => ({
    id: r.id,
    day: r.day,
    startTime: r.start_time,
    endTime: r.end_time,
    title: r.title,
    emoji: r.emoji,
    location: r.location,
    description: r.description,
    bring: r.bring,
    isPrivate: r.is_private,
    anytime: r.anytime ?? false,
    leadUserId: r.lead_user_id,
    leadName: r.lead_name,
    leadPhone: r.lead_phone,
    crewUserIds: r.crew_user_ids ?? [],
    position: r.position,
    imageUrl: r.image_url,
    links: r.links ?? [],
    signupEnabled: r.signup_enabled,
    signupCapacity: r.signup_capacity,
    signupSlotMinutes: r.signup_slot_minutes,
    signupStartTime: r.signup_start_time,
    signupEndTime: r.signup_end_time,
    signupMode: (r.signup_mode as "interval" | "slots" | "headcount" | null) ?? "interval",
    signupInstructions: r.signup_instructions,
    signupFields: r.signup_fields ?? [],
    signupReminderMinutes: r.signup_reminder_minutes ?? [],
    signupReminderEmail: r.signup_reminder_email ?? false,
    signupTeamSize: r.signup_team_size,
    tournamentEnabled: r.tournament_enabled ?? false,
    signupHideNames: r.signup_hide_names ?? false,
  }));
}

export async function fetchDinnerDrafts(): Promise<DinnerDraft[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_dinners")
    .select(
      "id, day, title, emoji, chef_user_id, chef_name, chef_phone, crew_user_ids, houses, menu, served_time, served_location, prep_time, prep_location, position",
    )
    .eq("fest_year", await activeFestYear())
    .order("day")
    .order("position");
  return ((data ?? []) as DinnerDraftRow[]).map((r) => ({
    id: r.id,
    day: r.day,
    title: r.title,
    emoji: r.emoji,
    chefUserId: r.chef_user_id,
    chefName: r.chef_name,
    chefPhone: r.chef_phone,
    crewUserIds: r.crew_user_ids ?? [],
    houses: r.houses ?? [],
    menu: r.menu,
    servedTime: r.served_time,
    servedLocation: r.served_location,
    prepTime: r.prep_time,
    prepLocation: r.prep_location,
    position: r.position,
  }));
}

export async function fetchPayeeDrafts(): Promise<PayeeDraft[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_payees")
    .select("id, name, role, venmo, zelle, applecash, paypal, note, position")
    .eq("fest_year", await activeFestYear())
    .order("position");
  return ((data ?? []) as PayeeDraftRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    venmo: r.venmo,
    zelle: r.zelle,
    applecash: r.applecash,
    paypal: r.paypal,
    note: r.note,
    position: r.position,
  }));
}

export async function fetchDuesDrafts(): Promise<DuesDraft[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_dues")
    .select("id, label, amount, note, per_day, position")
    .eq("fest_year", await activeFestYear())
    .order("position");
  return ((data ?? []) as DuesDraftRow[]).map((r) => ({
    id: r.id,
    label: r.label,
    amount: r.amount,
    note: r.note,
    perDay: r.per_day,
    position: r.position,
  }));
}

export async function fetchActivityDrafts(): Promise<ActivityDraft[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  const { data } = await sb
    .from("fest_activities")
    .select("id, title, emoji, blurb, details, location, lead_user_id, lead_name, lead_phone, crew_user_ids, signup_enabled, signup_capacity, signup_slot_minutes, signup_start_time, signup_end_time, signup_mode, signup_instructions, signup_fields, signup_reminder_minutes, signup_reminder_email, position")
    .eq("fest_year", await activeFestYear())
    .order("position");
  return ((data ?? []) as ActivityDraftRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    blurb: r.blurb,
    details: r.details,
    location: r.location,
    leadUserId: r.lead_user_id,
    leadName: r.lead_name,
    leadPhone: r.lead_phone,
    crewUserIds: r.crew_user_ids ?? [],
    position: r.position,
    signupEnabled: r.signup_enabled,
    signupCapacity: r.signup_capacity,
    signupSlotMinutes: r.signup_slot_minutes,
    signupStartTime: r.signup_start_time,
    signupEndTime: r.signup_end_time,
    signupMode: (r.signup_mode as "interval" | "slots" | null) ?? "interval",
    signupInstructions: r.signup_instructions,
    signupFields: r.signup_fields ?? [],
    signupReminderMinutes: r.signup_reminder_minutes ?? [],
    signupReminderEmail: r.signup_reminder_email ?? false,
  }));
}

/** Member directory for the "who's in charge" / chef picker. Public read of
 *  `profiles` (names + avatars only). Empty with no backend. */
export interface FestMemberOption {
  id: string;
  name: string;
  avatarUrl: string | null;
}
export async function fetchMemberOptions(): Promise<FestMemberOption[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data } = await sb
      .from("profiles")
      .select("id, display_name, avatar_url")
      .order("display_name");
    return ((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map(
      (r) => ({ id: r.id, name: r.display_name?.trim() || "Member", avatarUrl: r.avatar_url }),
    );
  } catch {
    return [];
  }
}

// ── Starting a NEW fest year ──────────────────────────────────────────────────

/** Days between two ISO dates (b − a), date-only and DST-safe. */
function daysBetween(a: string, b: string): number {
  const from = new Date(`${a}T00:00:00`).getTime();
  const to = new Date(`${b}T00:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** Shift an ISO date by N days, clamped to `max` when given. */
function shiftDay(iso: string, days: number, max?: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const out = toISODate(d);
  return max && out > max ? max : out;
}

// ⚠️ There is deliberately NO function here that proposes next year's dates.
// The Family Fest week is DIFFERENT EVERY YEAR and the family decides it by
// POLL — it is not derivable from the last one (not "+1 year", not "the same
// week 52 weeks on"). A computed default would be a guess wearing the clothes of
// an answer: these dates drive the countdown, every phase of the season, the day
// pickers and RSVP, so a plausible-looking placeholder that nobody remembered to
// change would have the whole app confidently counting down to the wrong week —
// the same class of bug as the finished fest that kept announcing itself as live.
// StartNextFestYear starts with the date fields EMPTY and won't create a year
// until someone enters the week that was actually chosen.

export interface StartFestYearInput {
  year: number;
  name: string;
  tagline: string | null;
  startDate: string;
  endDate: string;
  /** Copy this year's schedule/dinners/dues/payees in as a starting point. */
  copyFromYear?: number | null;
}

/**
 * Open a NEW fest year — the "start fresh" half of the archive cycle.
 *
 * This is deliberately NOT `saveConfig` with different dates. `saveConfig`
 * upserts the CURRENT year's row, so editing 2026's dates to next summer would
 * drag the finished 2026 fest forward with them: its archive would show the
 * wrong week, and the hub would go straight back to counting down to a fest
 * that already happened. A new year is a new row, which is what leaves 2026
 * intact in Past Years.
 *
 * Because the new row is the newest `fest_config`, creating it is all it takes
 * to hand the hub over: `fetchFestContent()` resolves the current year from the
 * data, so the section starts planning the new fest and the old one slides into
 * the archive with nothing else to switch.
 *
 * The optional template copy carries over each event's IDENTITY and LOGISTICS
 * (title, emoji, time, location, description, what-to-bring, lead + crew) with
 * days shifted onto the new window — but deliberately NOT sign-up configuration
 * or tournament flags. Those are per-year live state whose slots, rosters and
 * reminder times are keyed to specific dates; resurrecting them would strand
 * last year's arrangements in a week that hasn't been planned yet. Turn them
 * back on per event once the new week has shape.
 */
export async function startFestYear(
  i: StartFestYearInput,
): Promise<{ error?: string; copied?: number }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  if (i.endDate < i.startDate) return { error: "End date must be on or after the start." };

  const uid = await currentUid();
  const stamp = { updated_at: new Date().toISOString(), updated_by: uid };

  // Refuse to overwrite a year that already exists — this button's whole job is
  // to ADD a fest, and an upsert here would silently rewrite a real one.
  const existing = (await fetchFestYears()).some((y) => y.year === i.year);
  if (existing) return { error: `Family Fest ${i.year} already exists.` };

  // The new year deliberately starts with NO theme line, NO cover and NO
  // palette of its own (migration 0219). A null look renders the built-in
  // `.ff-section` parchment — the 2026 look — so the year is never ugly while
  // it's being planned, and whatever it becomes is a decision someone makes in
  // the Planner rather than last year's identity inherited by accident. Copying
  // "Ye Olde Family Feste" forward is the one thing that would be actively
  // wrong: the theme is the part of a fest that is *supposed* to change.
  const { error: cfgError } = await sb.from("fest_config").insert({
    fest_year: i.year,
    name: i.name,
    tagline: i.tagline,
    start_date: i.startDate,
    end_date: i.endDate,
    theme: null,
    cover_url: null,
    ...stamp,
  });
  if (cfgError) return { error: cfgError.message };

  // From here on the year EXISTS — the important part succeeded. A copy failure
  // is reported but never rolls the year back: an empty new fest is a fine
  // place to start, and undoing the row would leave the editor with nothing.
  resolvedFestYear = i.year;
  festYearResolved = true;
  if (i.copyFromYear == null) return { copied: 0 };

  try {
    const from = i.copyFromYear;
    const [schedule, dinners, dues, payees] = await Promise.all([
      sb
        .from("fest_schedule_items")
        .select(
          "day, start_time, end_time, title, emoji, location, description, bring, is_private, anytime, lead_user_id, lead_name, lead_phone, crew_user_ids, position",
        )
        .eq("fest_year", from)
        .order("day")
        .order("position"),
      sb
        .from("fest_dinners")
        .select(
          "day, title, emoji, chef_user_id, chef_name, chef_phone, crew_user_ids, houses, menu, served_time, served_location, prep_time, prep_location, position",
        )
        .eq("fest_year", from)
        .order("day")
        .order("position"),
      sb.from("fest_dues").select("label, amount, note, per_day, position").eq("fest_year", from).order("position"),
      sb
        .from("fest_payees")
        .select("name, role, venmo, zelle, applecash, paypal, note, position")
        .eq("fest_year", from)
        .order("position"),
    ]);

    // ⚠️ Check the READ errors, not just the inserts. `select()` returning an
    // error leaves `.data` null, which mapped to an empty payload and then hit
    // the `payload.length === 0 ⇒ continue` skip below — so a table whose read
    // failed was silently left uncopied and the sheet still reported success,
    // just with a smaller count. A copy that half-happened has to say so.
    for (const [label, res] of [
      ["the schedule", schedule],
      ["the dinners", dinners],
      ["the dues", dues],
      ["the payees", payees],
    ] as const) {
      if (res.error) {
        return {
          error: `Family Fest ${i.year} was created, but ${label} couldn't be read from ${from}: ${res.error.message}`,
          copied: 0,
        };
      }
    }

    const source = (await fetchFestYears()).find((y) => y.year === from);
    // Shift by the gap between the two START dates, so a week moved to a
    // different part of the summer carries its shape with it. Anything that
    // falls past the new end (a shorter week) clamps onto the last day rather
    // than landing outside the fest, where no day card would render it.
    const shift = source ? daysBetween(source.startDate, i.startDate) : 0;

    const rows: { table: string; payload: Record<string, unknown>[] }[] = [
      {
        table: "fest_schedule_items",
        payload: ((schedule.data ?? []) as Record<string, unknown>[]).map((r) => ({
          ...r,
          day: shiftDay(String(r.day), shift, i.endDate),
          fest_year: i.year,
          ...stamp,
        })),
      },
      {
        table: "fest_dinners",
        payload: ((dinners.data ?? []) as Record<string, unknown>[]).map((r) => ({
          ...r,
          day: shiftDay(String(r.day), shift, i.endDate),
          fest_year: i.year,
          ...stamp,
        })),
      },
      {
        table: "fest_dues",
        payload: ((dues.data ?? []) as Record<string, unknown>[]).map((r) => ({
          ...r,
          fest_year: i.year,
          ...stamp,
        })),
      },
      {
        table: "fest_payees",
        payload: ((payees.data ?? []) as Record<string, unknown>[]).map((r) => ({
          ...r,
          fest_year: i.year,
          ...stamp,
        })),
      },
    ];

    let copied = 0;
    for (const { table, payload } of rows) {
      if (payload.length === 0) continue;
      const { error } = await sb.from(table).insert(payload);
      if (error) return { error: `${i.year} was created, but copying ${table} failed: ${error.message}`, copied };
      copied += payload.length;
    }
    return { copied };
  } catch (e) {
    return {
      error: `Family Fest ${i.year} was created, but copying last year's plan failed: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    };
  }
}
