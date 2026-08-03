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
  /** Committee-LEVEL lead (migration 0177) — a lead of the whole committee,
   *  independent of any subcommittee/area. Gates the private Leads chat + scoped
   *  roster control alongside the "· Lead" area-lead notion. */
  isLead: boolean;
}

interface RosterRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[] | null;
  position: number;
  linked_user_id: string | null;
  is_lead?: boolean | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

// The is_lead column arrives with migration 0177; until it's applied, selecting
// or writing it errors 42703. Everything here degrades gracefully (retry without
// it) so the committee pages keep working before the migration runs.
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

/** A "Pending" (account-less) roster person, for reuse in the member picker. */
export interface PendingPerson {
  name: string;
  email: string | null;
  phone: string | null;
}

/** Every account-LESS ("Pending verification") roster person across ALL
 *  committees, deduped by email (falling back to name). Lets the "Choose a
 *  member" picker offer someone already on the roster-but-not-in-the-app, so an
 *  admin/lead can add the same pending person to another committee without
 *  re-typing their name/email. `committee_roster` is members-readable (0081), so
 *  a signed-in admin/lead sees all rows. Empty on no backend / any error. */
export async function fetchPendingRosterPeople(): Promise<PendingPerson[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb
      .from("committee_roster")
      .select("name, email, phone")
      .is("linked_user_id", null);
    if (error || !data) return [];
    const seen = new Set<string>();
    const out: PendingPerson[] = [];
    for (const r of data as { name: string; email: string | null; phone: string | null }[]) {
      const nm = (r.name ?? "").trim();
      if (!nm) continue;
      const key = (r.email && r.email.trim().toLowerCase()) || `name:${nm.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: nm, email: r.email?.trim() || null, phone: r.phone?.trim() || null });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Create or update a roster entry (admin- or lead-gated by RLS). */
export async function saveRosterEntry(input: {
  id?: string;
  committeeSlug: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  linkedUserId: string | null;
  /** Committee-level lead flag (migration 0177). Omit to leave unchanged on an
   *  edit / default false on a new row. */
  isLead?: boolean;
}): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const uid = (await sb.auth.getUser()).data.user?.id ?? null;
  const base = {
    committee_slug: input.committeeSlug,
    name: input.name,
    email: input.email,
    phone: input.phone,
    roles: input.roles,
    linked_user_id: input.linkedUserId,
    updated_at: new Date().toISOString(),
    updated_by: uid,
  };
  const write = (row: Record<string, unknown>) =>
    input.id
      ? sb.from("committee_roster").update(row).eq("id", input.id)
      : sb.from("committee_roster").insert(row);
  // Try with is_lead; if the column isn't there yet (pre-0177), retry without it
  // so the rest of the edit still saves.
  let { error } = await write(input.isLead === undefined ? base : { ...base, is_lead: input.isLead });
  if (error && isMissingColumn(error) && input.isLead !== undefined) {
    ({ error } = await write(base));
  }
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
    isLead: false,
  }));

  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return seed;
  try {
    const withLead = "id, name, email, phone, roles, position, linked_user_id, is_lead, profiles:linked_user_id(display_name, avatar_url)";
    const noLead = "id, name, email, phone, roles, position, linked_user_id, profiles:linked_user_id(display_name, avatar_url)";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- two select shapes (with/without is_lead) can't share one inferred type
    let res: any = await sb.from("committee_roster").select(withLead).eq("committee_slug", slug).order("position");
    if (res.error && isMissingColumn(res.error)) {
      // Pre-0177: no is_lead column yet — fall back so the roster still loads.
      res = await sb.from("committee_roster").select(noLead).eq("committee_slug", slug).order("position");
    }
    const rows = (res.data ?? []) as unknown as RosterRow[];
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
      isLead: r.is_lead ?? false,
    }));
  } catch {
    return seed;
  }
}
