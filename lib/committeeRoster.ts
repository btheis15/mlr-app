// Committee roster, DB-backed (migration 0056). Each slot can link to a real
// account (linked_user_id, auto-stamped when someone verifies with the matching
// email). Falls back to the in-code COMMITTEES seed when the table is empty /
// offline, so the roster always renders. Shared by the web roster UI; iOS reads
// the same table.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { COMMITTEES } from "@/lib/data";
import type { CommitteeMember } from "@/lib/types";

/** A roster slot, in the same shape the seed uses, plus its account link. */
export interface RosterEntry extends CommitteeMember {
  /** DB row id (absent for in-code seed fallback entries). */
  id?: string;
  /** The claimed account, if someone has verified with this slot's email. */
  linkedUserId: string | null;
  linkedName: string | null;
  linkedAvatarUrl: string | null;
}

interface RosterRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[] | null;
  position: number;
  linked_user_id: string | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

/** Create or update a roster entry (admin-gated by RLS). */
export async function saveRosterEntry(input: {
  id?: string;
  committeeSlug: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  linkedUserId: string | null;
}): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const uid = (await sb.auth.getUser()).data.user?.id ?? null;
  const row = {
    committee_slug: input.committeeSlug,
    name: input.name,
    email: input.email,
    phone: input.phone,
    roles: input.roles,
    linked_user_id: input.linkedUserId,
    updated_at: new Date().toISOString(),
    updated_by: uid,
  };
  const { error } = input.id
    ? await sb.from("committee_roster").update(row).eq("id", input.id)
    : await sb.from("committee_roster").insert(row);
  return error ? { error: error.message } : {};
}

/** Remove a roster entry (= remove them from the committee). */
export async function deleteRosterEntry(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("committee_roster").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** Live roster size per committee slug, in one query. Slugs with no DB rows are
 *  absent from the map, so callers fall back to the in-code seed count — mirrors
 *  `fetchCommitteeRoster`, which falls back to the seed when a slug has no rows. */
export async function fetchRosterCounts(): Promise<Record<string, number>> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return {};
  try {
    const { data } = await sb.from("committee_roster").select("committee_slug");
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as { committee_slug: string }[]) {
      counts[r.committee_slug] = (counts[r.committee_slug] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

/** The committee's roster from the DB (ordered), or the in-code seed as a
 *  fallback when there's no backend / the table is empty. */
export async function fetchCommitteeRoster(slug: string): Promise<RosterEntry[]> {
  const seed: RosterEntry[] = (COMMITTEES.find((c) => c.slug === slug)?.members ?? []).map((m) => ({
    ...m,
    linkedUserId: null,
    linkedName: null,
    linkedAvatarUrl: null,
  }));

  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return seed;
  try {
    const { data } = await sb
      .from("committee_roster")
      .select("id, name, email, phone, roles, position, linked_user_id, profiles:linked_user_id(display_name, avatar_url)")
      .eq("committee_slug", slug)
      .order("position");
    const rows = (data ?? []) as unknown as RosterRow[];
    if (!rows.length) return seed;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      roles: r.roles ?? undefined,
      email: r.email ?? undefined,
      phone: r.phone ?? undefined,
      linkedUserId: r.linked_user_id,
      linkedName: r.profiles?.display_name?.trim() || null,
      linkedAvatarUrl: r.profiles?.avatar_url ?? null,
    }));
  } catch {
    return seed;
  }
}
