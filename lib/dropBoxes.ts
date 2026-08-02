// Client helpers for drop boxes (migration 0171) — a shared "dump the photos
// and videos here, everyone sees them" folder: the app's account-free
// alternative to a Google Drive shared folder. Any signed-in member opens a
// box, adds as much as they want, and browses everything anyone dropped in.
// The bytes live on the Mac-mini media server (no size cap); these rows are
// just the folder + an ordered list of what's in it.
//
// Reads go through the Supabase client (members-only RLS; a flagged item is
// hidden from everyone but its uploader + admins). Writes go through SECURITY
// DEFINER RPCs. Degrades to "none" with no backend or pre-migration (42P01) —
// never throws, the lib/polls.ts idiom.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Media, MediaKind } from "@/lib/media";

export type DropBoxMediaStatus = "visible" | "pending" | "hidden";

export interface DropBoxItem {
  id: string;
  url: string;
  type: MediaKind;
  status: DropBoxMediaStatus;
  uploadedBy: string;
  createdAt: string;
}

export interface DropBox {
  id: string;
  title: string;
  emoji: string | null;
  createdBy: string;
  archivedAt: string | null;
  createdAt: string;
  items: DropBoxItem[];
  /** Convenience: newest-first items (what the grid renders). */
  count: number;
  /** Resolved client-side: creator or admin (can rename / archive / delete). */
  canManage: boolean;
}

/** Adapt a drop-box item to the shared MediaGrid/Lightbox shape. */
export function toMedia(item: DropBoxItem): Media {
  return { url: item.url, type: item.type };
}

type PgError = { code?: string; message?: string } | null;
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

interface ItemRow {
  id: string;
  storage_path: string;
  media_type: MediaKind;
  status: DropBoxMediaStatus;
  uploaded_by: string;
  created_at: string;
}
interface BoxRow {
  id: string;
  title: string;
  emoji: string | null;
  created_by: string;
  archived_at: string | null;
  created_at: string;
  drop_box_media: ItemRow[] | null;
}

function assemble(row: BoxRow, viewerId: string | null, isAdmin: boolean): DropBox {
  const items = (row.drop_box_media ?? [])
    .map(
      (m): DropBoxItem => ({
        id: m.id,
        url: m.storage_path,
        type: m.media_type,
        status: m.status,
        uploadedBy: m.uploaded_by,
        createdAt: m.created_at,
      }),
    )
    // Newest first — a drop box reads like a camera roll, most recent on top.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    createdBy: row.created_by,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    items,
    count: items.length,
    canManage: isAdmin || row.created_by === viewerId,
  };
}

const SELECT =
  "id, title, emoji, created_by, archived_at, created_at, drop_box_media(id, storage_path, media_type, status, uploaded_by, created_at)";

/** Every drop box the viewer can see (members-only), newest first, each with
 *  its items (RLS already hid anyone else's held media). Empty with no backend
 *  / pre-migration / on any error. */
export async function fetchDropBoxes(viewerId: string | null, isAdmin = false): Promise<DropBox[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    const { data, error } = await sb.from("drop_boxes").select(SELECT).order("created_at", { ascending: false });
    if (error) {
      if (!isMissingTable(error)) console.warn("fetchDropBoxes: read error", error.message);
      return [];
    }
    return ((data ?? []) as unknown as BoxRow[]).map((r) => assemble(r, viewerId, isAdmin));
  } catch {
    return [];
  }
}

/** One drop box by id (or null if it's gone / not visible). */
export async function fetchDropBox(id: string, viewerId: string | null, isAdmin = false): Promise<DropBox | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return null;
  try {
    const { data, error } = await sb.from("drop_boxes").select(SELECT).eq("id", id).maybeSingle();
    if (error) {
      if (!isMissingTable(error)) console.warn("fetchDropBox: read error", error.message);
      return null;
    }
    return data ? assemble(data as unknown as BoxRow, viewerId, isAdmin) : null;
  } catch {
    return null;
  }
}

// ── Write wrappers ────────────────────────────────────────────────────────────

type Res = { error?: string };
type IdRes = { id?: string; error?: string };

async function rpc(name: string, params: Record<string, unknown>): Promise<Res> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.rpc(name, params);
  return error ? { error: error.message } : {};
}

export async function createDropBox(title: string, emoji?: string | null): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("create_drop_box", { p_title: title, p_emoji: emoji ?? null });
  return error ? { error: error.message } : { id: data as string };
}

export function updateDropBox(id: string, input: { title?: string; emoji?: string | null }): Promise<Res> {
  return rpc("update_drop_box", { p_box: id, p_title: input.title ?? null, p_emoji: input.emoji ?? null });
}

export function setDropBoxArchived(id: string, archived: boolean): Promise<Res> {
  return rpc("set_drop_box_archived", { p_box: id, p_archived: archived });
}

export function deleteDropBox(id: string): Promise<Res> {
  return rpc("delete_drop_box", { p_box: id });
}

/** Attach one already-uploaded file (mini URL) to a box. */
export async function addDropBoxMedia(boxId: string, url: string, type: MediaKind): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { data, error } = await sb.rpc("add_drop_box_media", { p_box: boxId, p_url: url, p_type: type });
  return error ? { error: error.message } : { id: data as string };
}

export function removeDropBoxMedia(mediaId: string): Promise<Res> {
  return rpc("remove_drop_box_media", { p_media: mediaId });
}

/** Admin-only: release a false-positive hold (→ visible) or hide an item. */
export function setDropBoxMediaStatus(mediaId: string, status: DropBoxMediaStatus): Promise<Res> {
  return rpc("set_drop_box_media_status", { p_media: mediaId, p_status: status });
}
