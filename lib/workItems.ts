// Client helpers for the work items checklist (migration 0048). Any signed-in
// member can add items and check them off; admins can edit, delete, and link
// items to events. Reads are public (no sign-in required). Writes go through
// SECURITY DEFINER RPCs. Degrades to safe no-ops with no backend.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { House, WorkItem, WorkItemComment, WorkItemMedia, WorkItemStatus, WorkItemUrgency, WorkItemUrgencyColor } from "@/lib/types";

/** Display + sort metadata for each fixed urgency level (most urgent first).
 *  Chip uses Tailwind palette classes. `custom` has no fixed label/emoji/chip —
 *  see `urgencyMeta()`, which fills those in from the item's own custom_label/
 *  custom_color. */
export const URGENCY_META: Record<Exclude<WorkItemUrgency, "custom">, { label: string; emoji: string; rank: number; chip: string }> = {
  asap:         { label: "ASAP",         emoji: "🔴", rank: 0, chip: "bg-red-500/15 text-red-700 ring-red-500/30" },
  this_year:    { label: "This year",    emoji: "🟠", rank: 1, chip: "bg-orange-500/15 text-orange-700 ring-orange-500/30" },
  next_year:    { label: "Next year",    emoji: "🟡", rank: 2, chip: "bg-amber-500/15 text-amber-700 ring-amber-500/30" },
  nice_to_have: { label: "Nice to have", emoji: "🟢", rank: 3, chip: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30" },
};

/** Preset colors a custom urgency can pick, with matching emoji + chip classes. */
export const CUSTOM_URGENCY_COLORS: Record<WorkItemUrgencyColor, { emoji: string; chip: string }> = {
  red:    { emoji: "🔴", chip: "bg-red-500/15 text-red-700 ring-red-500/30" },
  orange: { emoji: "🟠", chip: "bg-orange-500/15 text-orange-700 ring-orange-500/30" },
  yellow: { emoji: "🟡", chip: "bg-amber-500/15 text-amber-700 ring-amber-500/30" },
  green:  { emoji: "🟢", chip: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30" },
  blue:   { emoji: "🔵", chip: "bg-blue-500/15 text-blue-700 ring-blue-500/30" },
  purple: { emoji: "🟣", chip: "bg-purple-500/15 text-purple-700 ring-purple-500/30" },
  gray:   { emoji: "⚪", chip: "bg-gray-500/15 text-gray-700 ring-gray-500/30" },
};

/** Display metadata for any item's urgency — fixed tiers read from URGENCY_META;
 *  `custom` builds its label/emoji/chip from the item's own custom_label/color. */
export function urgencyMeta(item: Pick<WorkItem, "urgency" | "customLabel" | "customColor">): { label: string; emoji: string; chip: string } | null {
  if (!item.urgency) return null;
  if (item.urgency !== "custom") return URGENCY_META[item.urgency];
  const color = item.customColor ?? "gray";
  const { emoji, chip } = CUSTOM_URGENCY_COLORS[color];
  return { label: item.customLabel ?? "Custom", emoji, chip };
}

/** Sort rank for an item's urgency (unset sorts last; custom sorts with "this year"). */
export function urgencyRank(item: Pick<WorkItem, "urgency" | "customColor"> | WorkItemUrgency | null): number {
  const u = item && typeof item === "object" ? item.urgency : item;
  if (!u) return 4;
  if (u === "custom") return 1.5;
  return URGENCY_META[u].rank;
}

function mapMedia(rows: Record<string, unknown>[] | null | undefined): WorkItemMedia[] {
  return (rows ?? [])
    .map((m) => ({
      id: m.id as string,
      url: m.storage_path as string,
      thumbnailUrl: (m.thumbnail_url as string | null | undefined) ?? null,
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
    urgency: (r.urgency as WorkItemUrgency | null) ?? null,
    customLabel: (r.custom_label as string | null) ?? null,
    customColor: (r.custom_color as WorkItemUrgencyColor | null) ?? null,
    houseId: (r.house_id as string | null) ?? null,
    media: mapMedia(r.work_item_media as Record<string, unknown>[] | undefined),
    commentCount: (() => {
      const c = r.work_item_comments as { count?: number }[] | undefined;
      return Array.isArray(c) && c[0]?.count != null ? (c[0].count as number) : 0;
    })(),
    createdBy: (r.created_by as string | null) ?? null,
    completedBy: (r.completed_by as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
    recurEveryYears: (r.recur_every_years as number | null) ?? null,
    surfaceOn: (r.surface_on as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** All work items the viewer can see (RLS returns MLR items + the viewer's house
 *  items), open first then done (newest-first within each group), with media.
 *  A recurring item's auto-created next cycle carries a future `surfaceOn` (Jan 1
 *  of the year it's next due) and is filtered out here until that date arrives —
 *  it exists in the DB right away (so the recurrence isn't lost) but stays out of
 *  sight so it doesn't pop back up mid-season, only once planning season starts. */
export async function fetchWorkItems(): Promise<WorkItem[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data } = await supabase
      .from("work_items")
      .select("*, work_item_media(*), work_item_comments(count)")
      .order("status", { ascending: true })       // 'done' sorts after 'open'
      .order("created_at", { ascending: false });
    const today = new Date().toISOString().slice(0, 10);
    return (data ?? []).map(mapRow).filter((i) => !i.surfaceOn || i.surfaceOn <= today);
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
    // Sort client-side (open first then done, newest-first within each) —
    // .order() on an embedded to-one relation orders the outer rows, not
    // reliably by the joined columns; mirrors fetchWorkItems()' own order.
    return (data ?? [])
      .map((r: any) => r.work_items)
      .filter(Boolean)
      .map(mapRow)
      .sort((a, b) =>
        a.status !== b.status
          ? a.status === "open" ? -1 : 1
          : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  } catch {
    return [];
  }
}

/** One scope section of the work checklist: MLR ("Around the Resort") or one
 *  house. Shared by WorkChecklist (the full checklist) and EventSheet (an
 *  event's linked items) so the grouping/ordering logic — and what to do with
 *  an item whose house isn't in the fetched `houses` list — lives in one
 *  place. `houses` should already be ordered by position (fetchHouses() is). */
export interface WorkScopeSection {
  key: string;
  title: string;
  emoji: string;
  items: WorkItem[];
}
export function groupWorkItemsByScope(items: WorkItem[], houses: House[]): WorkScopeSection[] {
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const sections: WorkScopeSection[] = [];
  const mlr = items.filter((i) => i.houseId === null);
  if (mlr.length) sections.push({ key: "mlr", title: "Around the Resort", emoji: "🌲", items: mlr });
  for (const h of houses) {
    const hi = items.filter((i) => i.houseId === h.id);
    if (hi.length) sections.push({ key: h.id, title: h.name, emoji: h.emoji, items: hi });
  }
  // Fallback: an item whose house isn't in the fetched list (shouldn't normally happen).
  const orphans = items.filter((i) => i.houseId !== null && !houseById.has(i.houseId));
  if (orphans.length) sections.push({ key: "other", title: "Other", emoji: "🔧", items: orphans });
  return sections;
}

/** "🌲 Around the Resort" or a house's "{emoji} {name}" for one item — the
 *  single-item counterpart to groupWorkItemsByScope(), for a flat list (e.g.
 *  EventWorkItemPicker) rather than sectioned groups. */
export function workItemScopeLabel(item: Pick<WorkItem, "houseId">, houses: House[]): string {
  if (item.houseId === null) return "🌲 Around the Resort";
  const h = houses.find((x) => x.id === item.houseId);
  return h ? `${h.emoji} ${h.name}` : "🔧 Other";
}

/** Per-house COUNTS of work items linked to an event, for every house — even
 *  one the viewer isn't a member of (unlike fetchEventWorkItems, which is
 *  RLS-scoped to MLR + the viewer's own house). Lets the event sheet show
 *  "🔒 MJT House · 2 items" for a house the viewer can't see the details of,
 *  instead of those items just silently vanishing (migration 0189). */
export interface EventWorkItemHouseCount {
  houseId: string;
  name: string;
  emoji: string;
  count: number;
}
export async function fetchEventWorkItemHouseCounts(eventId: string): Promise<EventWorkItemHouseCount[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data } = await supabase.rpc("event_work_item_house_counts", { p_event_id: eventId });
    return ((data ?? []) as { house_id: string; house_name: string; house_emoji: string; item_count: number }[]).map((r) => ({
      houseId: r.house_id,
      name: r.house_name,
      emoji: r.house_emoji,
      count: r.item_count,
    }));
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
  urgency?: WorkItemUrgency | null;
  customLabel?: string | null;
  customColor?: WorkItemUrgencyColor | null;
  houseId?: string | null;
  /** Recurs every N years (1-15); null/undefined = one-off. */
  recurEveryYears?: number | null;
}): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { data, error } = await supabase.rpc("create_work_item", {
    p_title: input.title,
    p_notes: input.notes ?? null,
    p_category: input.category ?? null,
    p_people_needed: input.peopleNeeded ?? null,
    p_house_id: input.houseId ?? null,
    p_urgency: input.urgency ?? null,
    p_custom_label: input.urgency === "custom" ? input.customLabel ?? null : null,
    p_custom_color: input.urgency === "custom" ? input.customColor ?? null : null,
    p_recur_every_years: input.recurEveryYears ?? null,
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
  thumbnailUrl?: string | null,
): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Not connected" };
  let { data, error } = await supabase.rpc("add_work_item_media", {
    p_work_item_id: workItemId,
    p_url: url,
    p_media_type: type,
    p_position: position,
    p_thumbnail_url: thumbnailUrl ?? null,
  });
  // Pre-0173 fallback: the RPC doesn't have the 5th param yet.
  if (error && (error.code === "PGRST202" || /find the function|schema cache/i.test(error.message ?? ""))) {
    ({ data, error } = await supabase.rpc("add_work_item_media", {
      p_work_item_id: workItemId,
      p_url: url,
      p_media_type: type,
      p_position: position,
    }));
  }
  if (error) return { error: error.message };
  return { id: data as string };
}

/** Remove a work-item attachment (item creator or admin). */
export async function removeWorkItemMedia(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("remove_work_item_media", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Comments on one work item (oldest first), with author name/avatar + @mentions
 *  stitched in. RLS returns only comments the viewer can see (parent scope). */
export async function fetchWorkItemComments(workItemId: string): Promise<WorkItemComment[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data: rows } = await supabase
      .from("work_item_comments")
      .select("id, work_item_id, author_id, text, created_at")
      .eq("work_item_id", workItemId)
      .order("created_at", { ascending: true });
    const comments = (rows ?? []) as { id: string; work_item_id: string; author_id: string; text: string; created_at: string }[];
    if (!comments.length) return [];
    const ids = comments.map((c) => c.id);
    const authorIds = Array.from(new Set(comments.map((c) => c.author_id)));
    const [mentionsRes, profilesRes] = await Promise.all([
      supabase.from("work_item_comment_mentions").select("comment_id, mentioned_user_id").in("comment_id", ids),
      supabase.from("profiles").select("id, display_name, avatar_url").in("id", authorIds),
    ]);
    const names = new Map<string, string>();
    const avatars = new Map<string, string | null>();
    for (const p of (profilesRes.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
      names.set(p.id, p.display_name?.trim() || "Member");
      avatars.set(p.id, p.avatar_url);
    }
    const mByComment: Record<string, string[]> = {};
    for (const m of (mentionsRes.data ?? []) as { comment_id: string; mentioned_user_id: string }[]) {
      (mByComment[m.comment_id] ||= []).push(m.mentioned_user_id);
    }
    return comments.map((c) => ({
      id: c.id,
      workItemId: c.work_item_id,
      authorId: c.author_id,
      authorName: names.get(c.author_id) || "Member",
      authorAvatarUrl: avatars.get(c.author_id) ?? null,
      text: c.text,
      mentions: mByComment[c.id] ?? [],
      createdAt: c.created_at,
    }));
  } catch {
    return [];
  }
}

/** Add a comment (any member who can see the item). Writes the comment then its
 *  @mention rows. RLS enforces scope (MLR-public vs house-only). */
export async function addWorkItemComment(
  workItemId: string,
  text: string,
  mentionIds: string[] = [],
): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { error: "Sign in required" };
  const { data, error } = await supabase
    .from("work_item_comments")
    .insert({ work_item_id: workItemId, author_id: uid, text: text.trim() })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const id = (data as { id: string }).id;
  if (mentionIds.length) {
    await supabase
      .from("work_item_comment_mentions")
      .insert(mentionIds.map((m) => ({ comment_id: id, mentioned_user_id: m })));
  }
  return { id };
}

/** Delete a comment (author or admin). */
export async function removeWorkItemComment(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.from("work_item_comments").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** Mark an item done (any signed-in member). */
export async function markWorkItemDone(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("mark_work_item_done", { p_id: id });
  return error ? { error: error.message } : {};
}

/** Edit an item's fields + status (admins for any item; the author for their own —
 *  the update_work_item RPC enforces this, migration 0079). */
export async function updateWorkItem(
  id: string,
  input: {
    title: string;
    notes?: string;
    category?: string;
    status: WorkItemStatus;
    peopleNeeded?: number | null;
    urgency?: WorkItemUrgency | null;
    customLabel?: string | null;
    customColor?: WorkItemUrgencyColor | null;
    houseId?: string | null;
    /** Recurs every N years (1-15); null/undefined = one-off. */
    recurEveryYears?: number | null;
  },
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
    p_urgency: input.urgency ?? null,
    p_custom_label: input.urgency === "custom" ? input.customLabel ?? null : null,
    p_custom_color: input.urgency === "custom" ? input.customColor ?? null : null,
    p_recur_every_years: input.recurEveryYears ?? null,
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

/** Unlink a work item from an event (admin OR that event's own creator,
 *  migration 0188) — only removes the link, never the item itself. */
export async function removeWorkItemFromEvent(
  eventId: string,
  workItemId: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected" };
  const { error } = await supabase.rpc("remove_work_item_from_event", {
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
