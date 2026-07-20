// Family roster, DB-backed (migration 0123). The master list of family who
// aren't on the app yet: a temporary name, an email (the join key), a phone, and
// an optional house assignment. Each slot auto-links to a real account when
// someone verifies with the matching email (linked_user_id, stamped by a
// trigger), carrying their pre-set house + temp name onto the new account.
// Sibling of lib/committeeRoster.ts. Reads are member-gated; writes are admin-
// only (both enforced by RLS). Degrades to safe empties / no-ops with no backend.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** A family-roster person, plus their account link (once they've signed up). */
export interface FamilyRosterEntry {
  id: string;
  /** Temporary display name (admin-set); seeds the account name on signup. */
  name: string;
  email: string | null;
  phone: string | null;
  houseId: string | null;
  position: number;
  /** The claimed account, once someone verifies with this slot's email. */
  linkedUserId: string | null;
  linkedName: string | null;
  linkedAvatarUrl: string | null;
}

interface RosterRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  house_id: string | null;
  position: number;
  linked_user_id: string | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

function mapRow(r: RosterRow): FamilyRosterEntry {
  return {
    id: r.id,
    name: r.name,
    email: r.email ?? null,
    phone: r.phone ?? null,
    houseId: r.house_id ?? null,
    position: r.position,
    linkedUserId: r.linked_user_id,
    linkedName: r.profiles?.display_name?.trim() || null,
    linkedAvatarUrl: r.profiles?.avatar_url ?? null,
  };
}

/** The whole family roster (ordered). Empty with no backend / before 0123. */
export async function fetchFamilyRoster(): Promise<FamilyRosterEntry[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data } = await sb
      .from("family_roster")
      .select("id, name, email, phone, house_id, position, linked_user_id, profiles:linked_user_id(display_name, avatar_url)")
      .order("name");
    return ((data ?? []) as unknown as RosterRow[]).map(mapRow);
  } catch {
    return [];
  }
}

/** True when migration 0123 hasn't been applied yet (table missing). Lets the
 *  admin UI show a "run the migration" hint instead of a silent empty list. */
export async function familyRosterReady(): Promise<boolean> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return false;
  const { error } = await sb.from("family_roster").select("id").limit(1);
  // 42P01 = undefined_table (pre-migration); PGRST205 = schema-cache miss.
  if (error && (error.code === "42P01" || error.code === "PGRST205")) return false;
  return true;
}

/** Create or update a roster person (admin-gated by RLS). The link trigger
 *  stamps linked_user_id from the email, so callers never set it directly. */
export async function saveFamilyRosterEntry(input: {
  id?: string;
  name: string;
  email: string | null;
  phone: string | null;
  houseId?: string | null;
  position?: number;
}): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const uid = (await sb.auth.getUser()).data.user?.id ?? null;
  const row = {
    name: input.name.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    ...(input.houseId !== undefined ? { house_id: input.houseId } : {}),
    ...(input.position != null ? { position: input.position } : {}),
    updated_at: new Date().toISOString(),
    updated_by: uid,
  };
  const { error } = input.id
    ? await sb.from("family_roster").update(row).eq("id", input.id)
    : await sb.from("family_roster").insert(row);
  return error ? { error: error.message } : {};
}

/** Assign a roster person to a house (or clear it with null). Admin-gated. */
export async function setFamilyRosterHouse(id: string, houseId: string | null): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("family_roster").update({ house_id: houseId, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { error: error.message } : {};
}

/** Remove a roster person (admin-gated by RLS). */
export async function deleteFamilyRosterEntry(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("family_roster").delete().eq("id", id);
  return error ? { error: error.message } : {};
}
