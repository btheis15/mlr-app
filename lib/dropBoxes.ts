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
import type { CapturedAtSource, Media, MediaKind } from "@/lib/media";
import { fetchProfiles } from "@/lib/roles";

export type DropBoxMediaStatus = "visible" | "pending" | "hidden";

export interface DropBoxItem {
  id: string;
  url: string;
  /** Small preview url — the grid renders this instead of the full-res `url`. */
  thumbnailUrl: string | null;
  type: MediaKind;
  status: DropBoxMediaStatus;
  uploadedBy: string;
  /** Display name of whoever uploaded this item — resolved client-side from `profiles`. */
  uploadedByName: string;
  createdAt: string;
  /** When the photo/video was actually taken (EXIF/container metadata) — null
   *  when it couldn't be read, in which case the album sorts by `createdAt`
   *  (upload time) instead. See migration 0174. */
  capturedAt: string | null;
}

/**
 * How an album's grid is ordered. **Purely a per-viewer VIEWING preference** —
 * it's applied client-side over the already-fetched items and is never written
 * to the database, so changing it can't reorder the album for anybody else.
 * Persisted per device in localStorage (one setting for every album).
 *
 * - `"uploaded"` (**default**) — newest upload first, so your own photos land at
 *   the front of the grid the moment they finish uploading. This is the default
 *   specifically because capture order made a fresh upload scatter into the
 *   middle of the album by its shot date, which reads as the app glitching or
 *   losing the photos rather than as intentional sorting.
 * - `"captured"` — when the photo/video was actually TAKEN (EXIF / video
 *   container metadata, migration 0174/0175/0176), falling back to upload time
 *   for anything whose metadata couldn't be read, so nothing drops out of the
 *   list for lacking it. The chronological "how the week actually happened"
 *   view — good for building a photo book.
 */
export type DropBoxSort = "uploaded" | "captured";

export const DROP_BOX_SORT_DEFAULT: DropBoxSort = "uploaded";
/** localStorage key for the viewer's own sort choice (device-local, not synced). */
export const DROP_BOX_SORT_KEY = "mlr.dropbox.sort";

/** Most-recent-first comparator for the given order. Capture order falls back
 *  to upload time when `capturedAt` is null (unreadable metadata). */
export function dropBoxItemComparator(sort: DropBoxSort) {
  return (a: DropBoxItem, b: DropBoxItem) =>
    sort === "captured"
      ? (b.capturedAt ?? b.createdAt).localeCompare(a.capturedAt ?? a.createdAt)
      : b.createdAt.localeCompare(a.createdAt);
}

/** Re-order a copy of `items` for the viewer's chosen sort. */
export function sortDropBoxItems(items: DropBoxItem[], sort: DropBoxSort): DropBoxItem[] {
  return [...items].sort(dropBoxItemComparator(sort));
}

export interface DropBox {
  id: string;
  title: string;
  emoji: string | null;
  createdBy: string;
  /** Display name of whoever created this album — resolved client-side from `profiles`. */
  createdByName: string;
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
  return { url: item.url, type: item.type, thumbnailUrl: item.thumbnailUrl };
}

type PgError = { code?: string; message?: string } | null;
function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

interface ItemRow {
  id: string;
  storage_path: string;
  thumbnail_url: string | null;
  media_type: MediaKind;
  status: DropBoxMediaStatus;
  uploaded_by: string;
  created_at: string;
  captured_at?: string | null;
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

function assemble(row: BoxRow, viewerId: string | null, isAdmin: boolean, names: Map<string, string>): DropBox {
  const nameFor = (id: string) => names.get(id) || "Member";
  const items = (row.drop_box_media ?? [])
    .map(
      (m): DropBoxItem => ({
        id: m.id,
        url: m.storage_path,
        thumbnailUrl: m.thumbnail_url,
        type: m.media_type,
        status: m.status,
        uploadedBy: m.uploaded_by,
        uploadedByName: nameFor(m.uploaded_by),
        createdAt: m.created_at,
        capturedAt: m.captured_at ?? null,
      }),
    )
    // Newest upload first — the DEFAULT order (see sortDropBoxItems). The
    // viewer can switch to capture order in the UI.
    .sort(dropBoxItemComparator("uploaded"));
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    createdBy: row.created_by,
    createdByName: nameFor(row.created_by),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    items,
    count: items.length,
    canManage: isAdmin || row.created_by === viewerId,
  };
}

/** Every distinct creator/uploader id across a batch of box rows — the input
 *  to one bulk `fetchProfiles()` call rather than a query per name. */
function idsIn(rows: BoxRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.created_by);
    for (const m of r.drop_box_media ?? []) ids.add(m.uploaded_by);
  }
  return Array.from(ids);
}

const SELECT =
  "id, title, emoji, created_by, archived_at, created_at, drop_box_media(id, storage_path, thumbnail_url, media_type, status, uploaded_by, created_at, captured_at)";
// Pre-0174 fallback (captured_at column doesn't exist yet on this project).
const SELECT_NO_CAPTURED =
  "id, title, emoji, created_by, archived_at, created_at, drop_box_media(id, storage_path, thumbnail_url, media_type, status, uploaded_by, created_at)";
// Pre-0173 fallback (thumbnail_url column doesn't exist yet on this project either).
const SELECT_NO_THUMB =
  "id, title, emoji, created_by, archived_at, created_at, drop_box_media(id, storage_path, media_type, status, uploaded_by, created_at)";

function isMissingColumn(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

/** Every drop box the viewer can see (members-only), newest first, each with
 *  its items (RLS already hid anyone else's held media). Empty with no backend
 *  / pre-migration / on any error. */
export async function fetchDropBoxes(viewerId: string | null, isAdmin = false): Promise<DropBox[]> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- three select shapes (full / no-captured_at / no-thumbnail_url) can't share one inferred type
    let res: any = await sb.from("drop_boxes").select(SELECT).order("created_at", { ascending: false });
    if (res.error && isMissingColumn(res.error)) {
      res = await sb.from("drop_boxes").select(SELECT_NO_CAPTURED).order("created_at", { ascending: false });
    }
    if (res.error && isMissingColumn(res.error)) {
      res = await sb.from("drop_boxes").select(SELECT_NO_THUMB).order("created_at", { ascending: false });
    }
    if (res.error) {
      if (!isMissingTable(res.error)) console.warn("fetchDropBoxes: read error", res.error.message);
      return [];
    }
    const rows = (res.data ?? []) as unknown as BoxRow[];
    const names = new Map((await fetchProfiles(idsIn(rows))).map((p) => [p.id, p.name]));
    return rows.map((r) => assemble(r, viewerId, isAdmin, names));
  } catch {
    return [];
  }
}

/** One drop box by id (or null if it's gone / not visible). */
export async function fetchDropBox(id: string, viewerId: string | null, isAdmin = false): Promise<DropBox | null> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- three select shapes (full / no-captured_at / no-thumbnail_url) can't share one inferred type
    let res: any = await sb.from("drop_boxes").select(SELECT).eq("id", id).maybeSingle();
    if (res.error && isMissingColumn(res.error)) {
      res = await sb.from("drop_boxes").select(SELECT_NO_CAPTURED).eq("id", id).maybeSingle();
    }
    if (res.error && isMissingColumn(res.error)) {
      res = await sb.from("drop_boxes").select(SELECT_NO_THUMB).eq("id", id).maybeSingle();
    }
    if (res.error) {
      if (!isMissingTable(res.error)) console.warn("fetchDropBox: read error", res.error.message);
      return null;
    }
    if (!res.data) return null;
    const row = res.data as unknown as BoxRow;
    const names = new Map((await fetchProfiles(idsIn([row]))).map((p) => [p.id, p.name]));
    return assemble(row, viewerId, isAdmin, names);
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

/** Attach one already-uploaded file (mini URL) to a box. `capturedAt` (ISO,
 *  when known) drives the album's most-recent-first sort ahead of upload time;
 *  `capturedAtSource` says whether that's real file metadata (`exif`/`video`,
 *  from extractExifCapturedAt or the mini's ffprobe read) or the weaker
 *  source-post proxy (`post`), so the mini's sweep can upgrade the proxy later
 *  without ever downgrading real metadata. `creditUserId` credits someone OTHER
 *  than the caller as the uploader — e.g. a Feed post's original author, when
 *  an admin is the one referencing that post's photo into an album (only
 *  honored server-side when the caller is an admin; otherwise ignored, see
 *  migration 0180). */
export async function addDropBoxMedia(
  boxId: string,
  url: string,
  type: MediaKind,
  thumbnailUrl?: string | null,
  capturedAt?: string | null,
  capturedAtSource?: CapturedAtSource | null,
  creditUserId?: string | null,
): Promise<IdRes> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const isStale = (e: { code?: string; message?: string } | null) =>
    !!e && (e.code === "PGRST202" || /find the function|schema cache/i.test(e.message ?? ""));

  let { data, error } = await sb.rpc("add_drop_box_media", {
    p_box: boxId,
    p_url: url,
    p_type: type,
    p_thumbnail_url: thumbnailUrl ?? null,
    p_captured_at: capturedAt ?? null,
    p_captured_at_source: capturedAtSource ?? null,
    p_credit_user_id: creditUserId ?? null,
  });
  // Pre-0180 fallback: no p_credit_user_id param yet.
  if (isStale(error)) {
    ({ data, error } = await sb.rpc("add_drop_box_media", {
      p_box: boxId,
      p_url: url,
      p_type: type,
      p_thumbnail_url: thumbnailUrl ?? null,
      p_captured_at: capturedAt ?? null,
      p_captured_at_source: capturedAtSource ?? null,
    }));
  }
  // Pre-0175 fallback: no p_captured_at_source param yet.
  if (isStale(error)) {
    ({ data, error } = await sb.rpc("add_drop_box_media", {
      p_box: boxId,
      p_url: url,
      p_type: type,
      p_thumbnail_url: thumbnailUrl ?? null,
      p_captured_at: capturedAt ?? null,
    }));
  }
  // Pre-0174 fallback: no p_captured_at either.
  if (isStale(error)) {
    ({ data, error } = await sb.rpc("add_drop_box_media", {
      p_box: boxId,
      p_url: url,
      p_type: type,
      p_thumbnail_url: thumbnailUrl ?? null,
    }));
  }
  // Pre-0173 fallback: no p_thumbnail_url either.
  if (isStale(error)) {
    ({ data, error } = await sb.rpc("add_drop_box_media", { p_box: boxId, p_url: url, p_type: type }));
  }
  return error ? { error: error.message } : { id: data as string };
}

export function removeDropBoxMedia(mediaId: string): Promise<Res> {
  return rpc("remove_drop_box_media", { p_media: mediaId });
}

/** Admin-only: release a false-positive hold (→ visible) or hide an item. */
export function setDropBoxMediaStatus(mediaId: string, status: DropBoxMediaStatus): Promise<Res> {
  return rpc("set_drop_box_media_status", { p_media: mediaId, p_status: status });
}
