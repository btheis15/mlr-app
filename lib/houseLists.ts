// Client helpers for House Lists (migration 0169) — shared lists for a house
// (0064): groceries for the weekend, a cabin close-up checklist, a packing list.
// ONE flexible shape (title + checkable items), so a shopping list and a
// checklist are the same thing and there's no "kind" to pick.
//
// Anyone in the house can create a list and add / check / edit / delete ANY item
// on it — this is a shared scratchpad, not a per-person to-do (the house's work
// items, 0066, remain the tracked author-owned surface). Reads are gated in the
// DB by is_house_member; every write goes through a SECURITY DEFINER RPC.
// Degrades to safe no-ops / empties with no backend or pre-migration (42P01),
// the lib/houseCalendar.ts + lib/polls.ts idiom — never throws.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { HouseList, HouseListItem } from "@/lib/types";

type PgError = { code?: string; message?: string } | null;

/** Missing relation/function ⇒ the 0169 migration hasn't run yet (same check as
 *  lib/polls.ts). Treated as "no lists", never as an error. */
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist/i.test(error.message ?? "") ||
    /function .* does not exist/i.test(error.message ?? "")
  );
}

/** A joined profile embed is an object or a 1-element array depending on the FK
 *  shape — handle both, like lib/houseCalendar.ts mapStay. */
type ProfileEmbed = { display_name: string | null } | { display_name: string | null }[] | null;
function embeddedName(p: ProfileEmbed): string | null {
  const one = Array.isArray(p) ? p[0] : p;
  const name = one?.display_name?.trim();
  return name ? name : null;
}

interface ItemRow {
  id: string;
  list_id: string;
  text: string;
  checked_at: string | null;
  checked_by: string | null;
  created_by: string;
  created_at: string;
  position: number;
  checker?: ProfileEmbed;
}

interface ListRow {
  id: string;
  house_id: string;
  title: string;
  emoji: string | null;
  note: string | null;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  author?: ProfileEmbed;
  house_list_items?: ItemRow[] | null;
}

function mapItem(r: ItemRow): HouseListItem {
  return {
    id: r.id,
    listId: r.list_id,
    text: r.text,
    checkedAt: r.checked_at,
    checkedBy: r.checked_by,
    checkedByName: embeddedName(r.checker ?? null),
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function mapList(r: ListRow): HouseList {
  // Order items the way the list is meant to be read: open items first in the
  // order they were added, checked ones settling to the bottom. Sorting here (not
  // in the query) keeps the nested embed to a single round-trip and means an
  // optimistic check re-sorts without a refetch.
  const items = (r.house_list_items ?? [])
    .map(mapItem)
    .sort((a, b) => {
      const ac = a.checkedAt ? 1 : 0;
      const bc = b.checkedAt ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return a.createdAt.localeCompare(b.createdAt);
    });
  return {
    id: r.id,
    houseId: r.house_id,
    title: r.title,
    emoji: (r.emoji && r.emoji.trim()) || "📝",
    note: r.note,
    position: r.position,
    createdBy: r.created_by,
    authorName: embeddedName(r.author ?? null) ?? "Member",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items,
  };
}

/** Every list on a house, items included (house-read only — RLS). Newest lists
 *  first (create_house_list assigns min(position) - 1). Empty with no backend or
 *  pre-migration. */
export async function fetchHouseLists(houseId: string): Promise<HouseList[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb
      .from("house_lists")
      .select(
        "id, house_id, title, emoji, note, position, created_by, created_at, updated_at," +
          " author:created_by(display_name)," +
          " house_list_items(id, list_id, text, checked_at, checked_by, created_by, created_at, position," +
          " checker:checked_by(display_name))",
      )
      .eq("house_id", houseId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) return []; // pre-migration (isMissingTable) or any read error
    return ((data ?? []) as unknown as ListRow[]).map(mapList);
  } catch {
    return [];
  }
}

/** True once the 0169 migration is applied (used to show a setup hint instead of
 *  a silently empty screen). Cheap head-count probe. */
export async function houseListsAvailable(): Promise<boolean> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return false;
  try {
    const { error } = await sb.from("house_lists").select("id", { count: "exact", head: true }).limit(1);
    return !isMissingTable(error as PgError);
  } catch {
    return false;
  }
}

export interface HouseListInput {
  title: string;
  emoji?: string | null;
  note?: string | null;
}

/** Start a new list on a house. Any member. Returns the new id or an error. */
export async function createHouseList(
  houseId: string,
  input: HouseListInput,
): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_house_list", {
    p_house: houseId,
    p_title: input.title,
    p_emoji: input.emoji ?? "📝",
    p_note: input.note ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Rename / re-emoji a list. Any member of its house. */
export async function updateHouseList(id: string, input: HouseListInput): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("update_house_list", {
    p_id: id,
    p_title: input.title,
    p_emoji: input.emoji ?? null,
    p_note: input.note ?? null,
  });
  return error ? { error: error.message } : {};
}

/** Delete a list and its items. Any member of its house. */
export async function deleteHouseList(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("delete_house_list", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Add an item to the end of a list. Any member of its house. */
export async function addHouseListItem(listId: string, text: string): Promise<{ id?: string; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("add_house_list_item", { p_list: listId, p_text: text });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Edit an item's text. Any member of its house. */
export async function updateHouseListItem(id: string, text: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("update_house_list_item", { p_id: id, p_text: text });
  return error ? { error: error.message } : {};
}

/** Check / uncheck an item (stamps who + when). Any member of its house. */
export async function setHouseListItemChecked(id: string, checked: boolean): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("set_house_list_item_checked", { p_id: id, p_checked: checked });
  return error ? { error: error.message } : {};
}

/** Delete a single item. Any member of its house. */
export async function deleteHouseListItem(id: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc("delete_house_list_item", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Sweep every checked item off a list ("we're home from the store"). Returns
 *  how many were cleared. Any member of its house. */
export async function clearCheckedHouseListItems(listId: string): Promise<{ cleared?: number; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("clear_checked_house_list_items", { p_list: listId });
  if (error) return { error: error.message };
  return { cleared: (data as number) ?? 0 };
}

/** Uncheck everything, to reuse a recurring checklist next trip. Any member. */
export async function uncheckHouseListItems(listId: string): Promise<{ reset?: number; error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("uncheck_house_list_items", { p_list: listId });
  if (error) return { error: error.message };
  return { reset: (data as number) ?? 0 };
}

/** "3 of 8" progress for a list. */
export function listProgress(list: HouseList): { done: number; total: number } {
  return { done: list.items.filter((i) => i.checkedAt).length, total: list.items.length };
}

/** The one-line summary a list shows when collapsed / on the Hub tile. */
export function listSummary(list: HouseList): string {
  const { done, total } = listProgress(list);
  if (total === 0) return "Empty — add the first item";
  if (done === total) return `All ${total} done`;
  return `${done} of ${total} done`;
}
