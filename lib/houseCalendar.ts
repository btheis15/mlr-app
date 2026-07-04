// Client helpers for the House Calendar (migration 0071). A "stay" is one
// member's booking on their house's shared calendar — "I'm going up on these
// dates, with these people." Reads are gated in the DB by is_house_member; all
// writes go through SECURITY DEFINER RPCs (a member writes only their own stay;
// the author or an admin can edit/cancel it). Degrades to safe no-ops / empties
// with no backend — the same shape as lib/events.ts.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { HouseStay } from "@/lib/types";

interface StayRow {
  id: string;
  house_id: string;
  created_by: string;
  title: string | null;
  start_date: string;
  end_date: string;
  guest_names: string[] | null;
  note: string | null;
  created_at: string;
  // Embedded relation is an object (or array, depending on the FK shape) —
  // handle both defensively, like lib/events.ts mapAttendanceRow.
  profiles?:
    | { display_name: string | null; avatar_url: string | null }
    | { display_name: string | null; avatar_url: string | null }[]
    | null;
}

function mapStay(r: StayRow): HouseStay {
  const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    id: r.id,
    houseId: r.house_id,
    createdBy: r.created_by,
    authorName: (p?.display_name && p.display_name.trim()) || "Member",
    authorAvatarUrl: p?.avatar_url ?? null,
    title: r.title,
    startDate: r.start_date,
    endDate: r.end_date,
    guestNames: r.guest_names ?? [],
    note: r.note,
    createdAt: r.created_at,
  };
}

/** Every stay on a house's calendar, with the member's name + avatar (house-read
 *  only — RLS). Sorted by start date. Empty with no backend. */
export async function fetchHouseStays(houseId: string): Promise<HouseStay[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data } = await sb
      .from("house_stays")
      .select("id, house_id, created_by, title, start_date, end_date, guest_names, note, created_at, profiles:created_by(display_name, avatar_url)")
      .eq("house_id", houseId)
      .order("start_date", { ascending: true });
    return ((data ?? []) as StayRow[]).map(mapStay);
  } catch {
    return [];
  }
}

export interface StayInput {
  startDate: string;
  endDate: string;
  title?: string | null;
  /** The added people (free names, no account needed). */
  guestNames?: string[];
  note?: string | null;
}

/** Add my stay to a house calendar. Returns the new id, or an error message. */
export async function createHouseStay(
  houseId: string,
  input: StayInput,
): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_house_stay", {
    p_house: houseId,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_title: input.title ?? null,
    p_guest_names: input.guestNames ?? [],
    p_note: input.note ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Edit a stay (author or admin). */
export async function updateHouseStay(id: string, input: StayInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("update_house_stay", {
    p_id: id,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_title: input.title ?? null,
    p_guest_names: input.guestNames ?? [],
    p_note: input.note ?? null,
  });
  return error ? { error: error.message } : {};
}

/** Cancel a stay (author or admin). */
export async function deleteHouseStay(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("delete_house_stay", { p_id: id });
  return error ? { error: error.message } : {};
}

/** True while a stay covers `today` (someone's up there right now). */
export function isStayActive(stay: HouseStay, today: string): boolean {
  return stay.startDate <= today && today <= stay.endDate;
}

/** True once a stay has fully ended (its last day is before today). */
export function isStayPast(stay: HouseStay, today: string): boolean {
  return stay.endDate < today;
}

/** A friendly label for a stay when the member left the title blank. */
export function stayLabel(stay: HouseStay): string {
  if (stay.title && stay.title.trim()) return stay.title.trim();
  const first = stay.authorName.split(" ")[0] || stay.authorName;
  return `${first}'s stay`;
}

/** How many people this stay covers: the member (1) + everyone they added. */
export function stayHeadCount(stay: HouseStay): number {
  return 1 + stay.guestNames.length;
}
