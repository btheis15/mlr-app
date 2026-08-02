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

/** The fest year these tables are keyed on. Bump (or parameterize) for 2027. */
const FEST_YEAR = 2026;

// ── Fallbacks (the in-code seed; identical to the DB seed in migration 0053) ──

export const FALLBACK_CONFIG: FestConfigContent = {
  name: FAMILY_FEST.name,
  tagline: FAMILY_FEST.tagline,
  startDate: FAMILY_FEST.startDate,
  endDate: FAMILY_FEST.endDate,
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

interface ConfigRow {
  name: string;
  tagline: string | null;
  start_date: string;
  end_date: string;
}
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

function mapConfig(r: ConfigRow): FestConfigContent {
  return { name: r.name, tagline: r.tagline ?? "", startDate: r.start_date, endDate: r.end_date };
}
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

export async function fetchFestContent(): Promise<FestContent> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return SEED_CONTENT;
  try {
    const [config, dues, schedule, dinners, payees, activities, callouts] = await Promise.all([
      sb.from("fest_config").select("name, tagline, start_date, end_date").eq("fest_year", FEST_YEAR).maybeSingle(),
      sb.from("fest_dues").select("id, label, amount, note, per_day").eq("fest_year", FEST_YEAR).order("position"),
      sb
        .from("fest_schedule_items")
        .select(
          "id, day, start_time, end_time, title, emoji, location, description, bring, is_private, anytime, lead_user_id, lead_name, lead_phone, crew_user_ids, image_url, links, signup_enabled, signup_capacity, signup_slot_minutes, signup_start_time, signup_end_time, signup_mode, signup_instructions, signup_fields, signup_reminder_minutes, signup_reminder_email, signup_team_size, tournament_enabled, signup_hide_names",
        )
        .eq("fest_year", FEST_YEAR)
        .order("day")
        .order("position"),
      sb
        .from("fest_dinners")
        .select(
          "id, day, title, emoji, chef_user_id, chef_name, chef_phone, crew_user_ids, houses, menu, served_time, served_location, prep_time, prep_location",
        )
        .eq("fest_year", FEST_YEAR)
        .order("day")
        .order("position"),
      sb.from("fest_payees").select("id, name, role, venmo, zelle, applecash, paypal, note").eq("fest_year", FEST_YEAR).order("position"),
      sb
        .from("fest_activities")
        .select("id, title, emoji, blurb, details, location, lead_user_id, lead_name, lead_phone, crew_user_ids, signup_enabled, signup_capacity, signup_slot_minutes, signup_start_time, signup_end_time, signup_mode, signup_instructions, signup_fields, signup_reminder_minutes, signup_reminder_email")
        .eq("fest_year", FEST_YEAR)
        .order("position"),
      sb.from("home_callouts").select(CALLOUT_COLUMNS).order("position"),
    ]);

    const scheduleRows = (schedule.data ?? []) as ScheduleRow[];
    const dinnerRows = (dinners.data ?? []) as DinnerRow[];
    const payeeRows = (payees.data ?? []) as PayeeRow[];
    const activityRows = (activities.data ?? []) as ActivityRow[];
    const duesRows = (dues.data ?? []) as DuesRow[];
    const calloutRows = (callouts.data ?? []) as CalloutRow[];

    return {
      config: config.data ? mapConfig(config.data as ConfigRow) : FALLBACK_CONFIG,
      // Empty table ⇒ keep the seed so the page is never blank.
      schedule: scheduleRows.length ? scheduleRows.map(mapSchedule) : SCHEDULE,
      dinners: dinnerRows.length ? dinnerRows.map(mapDinner) : DINNERS,
      payees: payeeRows.length ? payeeRows.map(mapPayee) : PAYEES,
      activities: activityRows.length ? activityRows.map(mapActivity) : THINGS_TO_DO,
      dues: duesRows.length ? duesRows.map(mapDues) : FALLBACK_DUES,
      // Call-outs degrade on ERROR only (pre-0083 the table doesn't exist —
      // show the in-code t-shirt seed so Home is unchanged). An EMPTY table is
      // a real state ("no call-outs"): the seed must not resurrect a card an
      // editor deliberately deleted.
      callouts: callouts.error ? FALLBACK_CALLOUTS : calloutRows.map(mapCallout),
    };
  } catch {
    return SEED_CONTENT;
  }
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
  const payload = { ...row, fest_year: FEST_YEAR, updated_at: new Date().toISOString(), updated_by: await currentUid() };
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
}
/** Save the fest config. Keyed by fest_year (upsert), so there's exactly one row. */
export async function saveConfig(i: ConfigInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("fest_config").upsert(
    {
      fest_year: FEST_YEAR,
      name: i.name,
      tagline: i.tagline,
      start_date: i.startDate,
      end_date: i.endDate,
      updated_at: new Date().toISOString(),
      updated_by: await currentUid(),
    },
    { onConflict: "fest_year" },
  );
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
    .eq("fest_year", FEST_YEAR)
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
    .eq("fest_year", FEST_YEAR)
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
    .eq("fest_year", FEST_YEAR)
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
    .eq("fest_year", FEST_YEAR)
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
    .eq("fest_year", FEST_YEAR)
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
