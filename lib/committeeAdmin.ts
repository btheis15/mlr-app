// Admin-managed committee TAXONOMY: the committees themselves + the roles
// ("areas", migration 0063) inside each one. Backed by migration 0112's
// admin-gated RPCs (create/update/archive committee, add/rename/archive role).
// Reads come straight from the `committees` / `committee_areas` tables so a
// newly-created committee or role shows up everywhere the moment it's saved;
// writes go through the RPCs (RLS keeps them app-admin only).
//
// Everything degrades gracefully pre-migration: a missing archived_at column
// (42703) or missing table (42P01) falls back to the pre-0112 behavior, and the
// in-code COMMITTEES / FAMILY_FEST_AREAS seeds are the offline / empty-table
// fallback so the app always renders.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { COMMITTEES, FAMILY_FEST_AREAS } from "@/lib/data";

export interface CommitteeRow {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  description: string;
  position: number;
  /** Set once the committee has been "deleted" (archived, migration 0112). */
  archivedAt: string | null;
}

/** A role/subcommittee within a committee, with its archived state. */
export interface CommitteeAreaRow {
  area: string;
  /** Admin-set blurb (migration 0179) — "" when none / pre-migration. */
  description: string;
  archivedAt: string | null;
}

const MISSING_COLUMN = "42703";

/** All committees from the DB (live + archived). Returns the in-code seed when
 *  there's no backend / the table is empty, so lists always render. Callers
 *  filter `archivedAt` themselves (the admin editor wants both). */
export async function fetchCommittees(): Promise<CommitteeRow[]> {
  const seed: CommitteeRow[] = COMMITTEES.map((c, i) => ({
    id: c.slug, // seed has no uuid; slug stands in until the DB row loads
    slug: c.slug,
    name: c.name,
    emoji: c.emoji,
    description: c.description,
    position: i,
    archivedAt: null,
  }));
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return seed;
  try {
    const primary = await sb
      .from("committees")
      .select("id, slug, name, emoji, description, position, archived_at")
      .order("position", { ascending: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] | null = primary.data;
    if (primary.error && primary.error.code === MISSING_COLUMN) {
      // Pre-0112: no archived_at column yet — retry without it.
      const fb = await sb
        .from("committees")
        .select("id, slug, name, emoji, description, position")
        .order("position", { ascending: true });
      data = fb.data;
    } else if (primary.error) {
      return seed;
    }
    const rows = (data ?? []) as (Omit<CommitteeRow, "archivedAt"> & { archived_at?: string | null })[];
    if (!rows.length) return seed;
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      emoji: r.emoji,
      description: r.description,
      position: r.position,
      archivedAt: r.archived_at ?? null,
    }));
  } catch {
    return seed;
  }
}

/** One committee by slug (live or archived), or the seed row / null. */
export async function fetchCommitteeBySlug(slug: string): Promise<CommitteeRow | null> {
  const all = await fetchCommittees();
  return all.find((c) => c.slug === slug) ?? null;
}

/** The roles/areas for a committee. Live (non-archived) by default; pass
 *  `includeArchived` for the admin editor + the archived-chats surface. Family
 *  Fest falls back to its in-code seed if the allow-list table is empty. */
export async function fetchCommitteeAreas(
  slug: string,
  includeArchived = false,
): Promise<CommitteeAreaRow[]> {
  const seed: CommitteeAreaRow[] =
    slug === "family-fest" ? FAMILY_FEST_AREAS.map((area) => ({ area, description: "", archivedAt: null })) : [];
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return seed;
  try {
    // Column ladder: description (0179) and archived_at (0112) are both additive,
    // so retry progressively narrower selects on a 42703 so this reads at any
    // migration level.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: any = await sb
      .from("committee_areas")
      .select("area, description, archived_at")
      .eq("committee_slug", slug)
      .order("area", { ascending: true });
    if (res.error && res.error.code === MISSING_COLUMN) {
      res = await sb.from("committee_areas").select("area, archived_at").eq("committee_slug", slug).order("area", { ascending: true });
    }
    if (res.error && res.error.code === MISSING_COLUMN) {
      res = await sb.from("committee_areas").select("area").eq("committee_slug", slug).order("area", { ascending: true });
    }
    if (res.error) return seed; // missing table (42P01) or any other read error
    const rows = (res.data ?? []) as { area: string; description?: string | null; archived_at?: string | null }[];
    if (!rows.length) return seed;
    const mapped = rows.map((r) => ({ area: r.area, description: r.description ?? "", archivedAt: r.archived_at ?? null }));
    return includeArchived ? mapped : mapped.filter((r) => !r.archivedAt);
  } catch {
    return seed;
  }
}

/** Live role names only (the common case — join picker, roster grouping). */
export async function fetchLiveAreaNames(slug: string): Promise<string[]> {
  return (await fetchCommitteeAreas(slug, false)).map((a) => a.area);
}

/** Every committee's live roles in ONE round-trip, keyed by committee slug — for
 *  the Committees index, which shows each committee's subcommittees and would
 *  otherwise fire a query per committee. A committee with no roles is simply
 *  absent from the map. Falls back to the Family Fest seed (the same fallback
 *  fetchCommitteeAreas applies) when the table is empty / unreachable, so the
 *  index degrades the same way every other surface does. */
export async function fetchAreasByCommittee(): Promise<Record<string, string[]>> {
  const seed: Record<string, string[]> = { "family-fest": [...FAMILY_FEST_AREAS] };
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return seed;
  try {
    const primary = await sb
      .from("committee_areas")
      .select("committee_slug, area, archived_at")
      .order("area", { ascending: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] | null = primary.data;
    if (primary.error && primary.error.code === MISSING_COLUMN) {
      const fb = await sb
        .from("committee_areas")
        .select("committee_slug, area")
        .order("area", { ascending: true });
      data = fb.data;
    } else if (primary.error) {
      return seed;
    }
    const rows = (data ?? []) as { committee_slug: string; area: string; archived_at?: string | null }[];
    if (!rows.length) return seed;
    const map: Record<string, string[]> = {};
    for (const r of rows) {
      if (r.archived_at) continue;
      (map[r.committee_slug] ??= []).push(r.area);
    }
    return map;
  } catch {
    return seed;
  }
}

// ── The " · Lead" suffix idiom ─────────────────────────────────────────────────
// A person's role entry (committee_members.areas / committee_roster.roles) is
// either the plain role name or the name plus a trailing " · Lead" marking them
// as that role's lead (migrations 0063/0073). Both forms mean "on this role" —
// `can_access_committee_area` accepts either — so every membership check has to
// strip the suffix rather than compare the raw string, and every edit has to
// preserve it. These are the one place that logic lives.

export const LEAD_SUFFIX = " · Lead";

/** The role name behind an entry, with any " · Lead" stripped. */
export const baseArea = (entry: string): string =>
  entry.endsWith(LEAD_SUFFIX) ? entry.slice(0, -LEAD_SUFFIX.length) : entry;

/** Is this person on `area` at all (as a member OR its lead)? */
export const isOnArea = (areas: string[], area: string): boolean =>
  areas.some((a) => baseArea(a) === area);

/** Is this person the lead of `area` specifically? */
export const isAreaLead = (areas: string[], area: string): boolean =>
  areas.includes(area + LEAD_SUFFIX);

/** `areas` with `area` set (as lead or plain), replacing any existing entry for
 *  it — so toggling lead can never leave both "Meals" and "Meals · Lead". */
export const withArea = (areas: string[], area: string, lead = false): string[] => [
  ...areas.filter((a) => baseArea(a) !== area),
  lead ? area + LEAD_SUFFIX : area,
];

/** `areas` with `area` removed in either form. */
export const withoutArea = (areas: string[], area: string): string[] =>
  areas.filter((a) => baseArea(a) !== area);

/** Does this role list contain any area lead (a "· Lead" entry)? */
export const rolesIncludeAreaLead = (roles: string[] | null | undefined): boolean =>
  (roles ?? []).some((r) => r.endsWith(LEAD_SUFFIX));

/**
 * Is this roster entry a LEAD of the committee — unified across the two notions:
 * a **committee-level** lead (the `is_lead` flag, migration 0177, independent of
 * any subcommittee) OR an **area** lead (any "· Lead" role, migration 0172). This
 * is the single check everything that gates the private Leads chat, scoped roster
 * control, and lead notifications should use, so a committee with NO subcommittees
 * can still have leads. Admins are intentionally NOT folded in here (the Leads
 * room is leads-only by design — an admin who isn't a lead isn't in it).
 */
export const isCommitteeLead = (m: { roles?: string[] | null; isLead?: boolean | null }): boolean =>
  !!m?.isLead || rolesIncludeAreaLead(m?.roles);

type RpcResult = { error?: string };
const rpc = async (fn: string, args: Record<string, unknown>): Promise<RpcResult> => {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc(fn, args);
  return error ? { error: error.message } : {};
};

// ── Committee CRUD ────────────────────────────────────────────────────────────
export const createCommittee = (name: string, emoji: string, description: string) =>
  rpc("create_committee", { p_name: name, p_emoji: emoji, p_description: description });

export const updateCommittee = (
  cid: string,
  name: string,
  emoji: string,
  description: string,
) => rpc("update_committee", { cid, p_name: name, p_emoji: emoji, p_description: description });

export const archiveCommittee = (cid: string) => rpc("archive_committee", { cid });
export const restoreCommittee = (cid: string) => rpc("restore_committee", { cid });
/** PERMANENT delete (migration 0178) — purges the committee + all its chat
 *  history/roster/roles. Admin-only, irreversible. Distinct from archive. */
export const deleteCommittee = (cid: string) => rpc("delete_committee", { cid });

// ── Role / area CRUD ──────────────────────────────────────────────────────────
export const addCommitteeArea = (cid: string, area: string) =>
  rpc("add_committee_area", { cid, p_area: area });
export const renameCommitteeArea = (cid: string, oldArea: string, newArea: string) =>
  rpc("rename_committee_area", { cid, p_old: oldArea, p_new: newArea });
export const archiveCommitteeArea = (cid: string, area: string) =>
  rpc("archive_committee_area", { cid, p_area: area });
export const restoreCommitteeArea = (cid: string, area: string) =>
  rpc("restore_committee_area", { cid, p_area: area });
/** PERMANENT delete of a role (migration 0178) — removes it from the allow-list,
 *  strips it off everyone's roles, and purges its chat history. Irreversible. */
export const deleteCommitteeArea = (cid: string, area: string) =>
  rpc("delete_committee_area", { cid, p_area: area });
/** Set (or clear, with "") a role's description (migration 0179). Admin-only. */
export const setCommitteeAreaDescription = (cid: string, area: string, description: string) =>
  rpc("set_committee_area_description", { cid, p_area: area, p_description: description });
