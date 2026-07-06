// Client helpers for Houses (migrations 0064–0067). A house is a group members
// are designated into (e.g. "MJT House") with its own chat + scoped work items.
// A member belongs to at most one house (profiles.house_id). Houses are public-
// read; assignment goes through the admin-only set_member_house RPC. Degrades to
// safe no-ops / empties with no backend.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { House } from "@/lib/types";

function mapHouse(r: Record<string, unknown>): House {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    emoji: (r.emoji as string) || "🏠",
    description: (r.description as string) ?? "",
    position: (r.position as number | null) ?? 0,
    rules: (r.rules as string) ?? "",
  };
}

/** All houses, ordered (public read). */
export async function fetchHouses(): Promise<House[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data } = await supabase.from("houses").select("*").order("position");
    return (data ?? []).map(mapHouse);
  } catch {
    return [];
  }
}

/** The signed-in member's house, or null (no house / signed out / no backend).
 *  Pass `userId` to skip the auth round-trip when you already know it. */
export async function fetchMyHouse(userId?: string | null): Promise<House | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return null;
  try {
    const me = userId ?? (await sb.auth.getUser()).data.user?.id ?? null;
    if (!me) return null;
    const { data } = await sb
      .from("profiles")
      .select("house_id, houses:house_id(*)")
      .eq("id", me)
      .maybeSingle();
    const house = (data as { houses: Record<string, unknown> | null } | null)?.houses;
    return house ? mapHouse(house) : null;
  } catch {
    return null;
  }
}

/** Resolve a house from its slug (null if no backend / not found). */
export async function fetchHouseBySlug(slug: string): Promise<House | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return null;
  try {
    const { data } = await sb.from("houses").select("*").eq("slug", slug).maybeSingle();
    return data ? mapHouse(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Assign a member to a house (hid null clears it). Admin only (RPC-gated). */
export async function setMemberHouse(target: string, hid: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("set_member_house", { target, hid });
  return error ? { error: error.message } : {};
}

/** Save a house's shared "house rules" doc. Any member of the house (RPC-gated
 *  by is_house_member, migration 0072). Last write wins. */
export async function setHouseRules(hid: string, rules: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("set_house_rules", { hid, p_rules: rules });
  return error ? { error: error.message } : {};
}

/** Create or update a house (admin-gated by RLS). */
export async function saveHouse(input: {
  id?: string;
  slug: string;
  name: string;
  emoji: string;
  description?: string;
  position?: number;
}): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const row = {
    slug: input.slug,
    name: input.name,
    emoji: input.emoji,
    description: input.description ?? "",
    position: input.position ?? 0,
  };
  const { error } = input.id
    ? await sb.from("houses").update(row).eq("id", input.id)
    : await sb.from("houses").insert(row);
  return error ? { error: error.message } : {};
}

/** Delete a house (admin-gated by RLS). Un-assigns its members + cascades its
 *  house-only work items + chat; MLR items are untouched. */
export async function deleteHouse(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("houses").delete().eq("id", id);
  return error ? { error: error.message } : {};
}
