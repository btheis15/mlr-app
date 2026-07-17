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
    slug === "family-fest" ? FAMILY_FEST_AREAS.map((area) => ({ area, archivedAt: null })) : [];
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return seed;
  try {
    const primary = await sb
      .from("committee_areas")
      .select("area, archived_at")
      .eq("committee_slug", slug)
      .order("area", { ascending: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] | null = primary.data;
    if (primary.error && primary.error.code === MISSING_COLUMN) {
      const fb = await sb
        .from("committee_areas")
        .select("area")
        .eq("committee_slug", slug)
        .order("area", { ascending: true });
      data = fb.data;
    } else if (primary.error) {
      return seed; // missing table (42P01) or any other read error
    }
    const rows = (data ?? []) as { area: string; archived_at?: string | null }[];
    if (!rows.length) return seed;
    const mapped = rows.map((r) => ({ area: r.area, archivedAt: r.archived_at ?? null }));
    return includeArchived ? mapped : mapped.filter((r) => !r.archivedAt);
  } catch {
    return seed;
  }
}

/** Live role names only (the common case — join picker, roster grouping). */
export async function fetchLiveAreaNames(slug: string): Promise<string[]> {
  return (await fetchCommitteeAreas(slug, false)).map((a) => a.area);
}

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

// ── Role / area CRUD ──────────────────────────────────────────────────────────
export const addCommitteeArea = (cid: string, area: string) =>
  rpc("add_committee_area", { cid, p_area: area });
export const renameCommitteeArea = (cid: string, oldArea: string, newArea: string) =>
  rpc("rename_committee_area", { cid, p_old: oldArea, p_new: newArea });
export const archiveCommitteeArea = (cid: string, area: string) =>
  rpc("archive_committee_area", { cid, p_area: area });
export const restoreCommitteeArea = (cid: string, area: string) =>
  rpc("restore_committee_area", { cid, p_area: area });
