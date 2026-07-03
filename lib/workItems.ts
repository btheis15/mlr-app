// Client helpers for the work items checklist (migration 0048). Any signed-in
// member can add items and check them off; admins can edit, delete, and link
// items to events. Reads are public (no sign-in required). Writes go through
// SECURITY DEFINER RPCs. Degrades to safe no-ops with no backend.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { WorkItem, WorkItemMedia, WorkItemStatus } from "@/lib/types";

function mapMedia(rows: Record<string, unknown>[] | null | undefined): WorkItemMedia[] {
  return (rows ?? [])
    .map((m) => ({
      id: m.id as string,
      url: m.storage_path as string,
      type: ((m.media_type as string) === "video" ? "video" : "image") as "image" | "video",
      position: (m.position as number | null) ?? 0,
    }))
    .sort((a, b) => a.position - b.position);
}

function mapRow(r: Record<string, unknown>): WorkItem {
  return {
    id: r.id as string,
    title: r.title as string,
    notes: (r.notes as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    status: (r.status as WorkItemStatus) ?? "open",
    peopleNeeded: (r.people_needed as number | null) ?? null,
    houseId: (r.house_id as string | null) ?? null,
    media: mapMedia(r.work_item_media as Record<string, unknown>[] | undefined),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** All work items the viewer can see (RLS returns MLR items + the viewer's house
 *  items), open first then done (newest-first within each group), with media. */
export async function fetchWorkItems(): Promise<WorkItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data } = await supabase
      .from("work_items")
      .select("*, work_item_media(*)")
      .order("status", { ascending: true })       // 'done' sorts after 'open'
      .order("created_at", { ascending: false });
    return (data ?? []).map(mapRow);
  } catch {
    return [];
  }
}

/** Work items attached to a specific event. */
export async function fetchEventWorkItems(eventId: string): Promise<WorkItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data } = await supabase
      .from("event_work_items")
      .select("work_item_id, work_items(*)")
      .eq("event_id", eventId);
    return (data ?? [])
      .map((r: any) => r.work_items)
      .filter(Boolean)
      .map(mapRow);
  } catch {
    return [];
  }
}

/** Add a new item to the checklist. MLR item (houseId null) → any signed-in
 *  member; house item → members of that house. */
export async function createWorkItem(input: {
  title: string;
  notes?: string;
  category?: string;
  peopleNeeded?: number | null;
  houseId?: string | null;
}): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { data, error } = await supabase.rpc("create_work_item", {
    p_title: input.title,
    p_notes: input.notes ?? null,
    p_category: input.category ?? null,
    p_people_needed: input.peopleNeeded ?? null,
    p_house_id: input.houseId ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Attach a photo/video (already uploaded to the mini) to a work item. */
export async function addWorkItemMedia(
  workItemId: string,
  url: string,
  type: "image" | "video",
  position = 0,
): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { data, error } = await supabase.rpc("add_work_item_media", {
    p_work_item_id: workItemId,
    p_url: url,
    p_media_type: type,
    p_position: position,
  });
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Remove a work-item attachment (item creator or admin). */
export async function removeWorkItemMedia(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("remove_work_item_media", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Mark an item done (any signed-in member). */
export async function markWorkItemDone(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("mark_work_item_done", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Edit an item's fields + status (admin only). */
export async function updateWorkItem(
  id: string,
  input: { title: string; notes?: string; category?: string; status: WorkItemStatus; peopleNeeded?: number | null; houseId?: string | null },
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("update_work_item", {
    p_id: id,
    p_title: input.title,
    p_notes: input.notes ?? null,
    p_category: input.category ?? null,
    p_status: input.status,
    p_people_needed: input.peopleNeeded ?? null,
    p_house_id: input.houseId ?? null,
  });
  return error ? { error: error.message } : {};
}

/** Delete an item from the checklist (admin only). */
export async function deleteWorkItem(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("delete_work_item", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Link a single work item to an event (any signed-in member).
 *  Additive only — never removes other items already linked to the event. */
export async function addWorkItemToEvent(
  eventId: string,
  workItemId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("add_work_item_to_event", {
    p_event_id: eventId,
    p_work_item_id: workItemId,
  });
  return error ? { error: error.message } : {};
}

/** Replace the full set of work items attached to an event (admin only).
 *  Pass an empty array to clear all links for the event. */
export async function syncEventWorkItems(
  eventId: string,
  itemIds: string[],
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("sync_event_work_items", {
    p_event_id: eventId,
    p_item_ids: itemIds,
  });
  return error ? { error: error.message } : {};
}
