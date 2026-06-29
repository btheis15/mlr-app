// Client helpers for the work items checklist (migration 0048). Any signed-in
// member can add items and check them off; admins can edit, delete, and link
// items to events. Reads are public (no sign-in required). Writes go through
// SECURITY DEFINER RPCs. Degrades to safe no-ops with no backend.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { WorkItem, WorkItemStatus } from "@/lib/types";

function mapRow(r: Record<string, unknown>): WorkItem {
  return {
    id: r.id as string,
    title: r.title as string,
    notes: (r.notes as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    status: (r.status as WorkItemStatus) ?? "open",
    peopleNeeded: (r.people_needed as number | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** All work items, open first then done (newest-first within each group). */
export async function fetchWorkItems(): Promise<WorkItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data } = await supabase
      .from("work_items")
      .select("*")
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

/** Add a new item to the checklist (any signed-in member). */
export async function createWorkItem(input: {
  title: string;
  notes?: string;
  category?: string;
  peopleNeeded?: number | null;
}): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { data, error } = await supabase.rpc("create_work_item", {
    p_title: input.title,
    p_notes: input.notes ?? null,
    p_category: input.category ?? null,
    p_people_needed: input.peopleNeeded ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as string };
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
  input: { title: string; notes?: string; category?: string; status: WorkItemStatus; peopleNeeded?: number | null },
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("update_work_item", {
    p_id: id,
    p_title: input.title,
    p_notes: input.notes ?? null,
    p_category: input.category ?? null,
    p_status: input.status,
    p_people_needed: input.peopleNeeded ?? null,
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
