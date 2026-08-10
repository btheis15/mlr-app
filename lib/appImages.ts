// Admin-managed site images (the Home logo, the Family Fest cover, …) — stored
// as URLs in the shared `app_images` table (migration 0054) so admins can swap
// them in-app and both web + iOS update together. Reads are public; the bundled
// /public asset is the fallback when a key is unset/unreachable.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { prepareImageForUpload } from "@/lib/media";

/** Known image keys → the bundled fallback served from /public. */
export const SITE_IMAGE_FALLBACK: Record<string, string> = {
  home_logo: "/brand-logo-green.png",
  fest_cover: "/family-fest-2026.jpg",
};

const SITE_BUCKET = "site-assets";

/** All admin-set image URLs, keyed by slug. Empty with no backend. */
export async function fetchAppImages(): Promise<Record<string, string>> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return {};
  try {
    const { data } = await sb.from("app_images").select("key, url");
    const map: Record<string, string> = {};
    for (const r of (data ?? []) as { key: string; url: string | null }[]) {
      if (r.url && r.url.trim()) map[r.key] = r.url.trim();
    }
    return map;
  } catch {
    return {};
  }
}

/** The src to use for a key: the admin URL if set, else the bundled fallback. */
export function siteImageSrc(map: Record<string, string>, key: string): string {
  return map[key] ?? SITE_IMAGE_FALLBACK[key] ?? "";
}

// ── Writes (RLS-gated to can_edit_fest()) ─────────────────────────────────────

/** Upload an admin-managed site image to the public `site-assets` bucket and
 *  return its public URL. A fresh filename per upload busts any cache. */
export async function uploadSiteImage(file: File, key: string): Promise<string> {
  const sb = supabase;
  if (!sb) throw new Error("Sign-in isn't available.");
  const compressed = await prepareImageForUpload(file);
  const path = `${key}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage
    .from(SITE_BUCKET)
    .upload(path, compressed, { contentType: compressed.type || "image/jpeg", upsert: false });
  if (error) throw new Error(error.message);
  return sb.storage.from(SITE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Save (upsert) a key's URL. */
export async function saveAppImage(key: string, url: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const uid = (await sb.auth.getUser()).data.user?.id ?? null;
  const { error } = await sb.from("app_images").upsert(
    { key, url, updated_at: new Date().toISOString(), updated_by: uid },
    { onConflict: "key" },
  );
  return error ? { error: error.message } : {};
}

/** Clear a key → both apps revert to the bundled fallback. */
export async function resetAppImage(key: string): Promise<{ error?: string }> {
  const sb = supabase;
  if (!sb) return { error: "Not available." };
  const { error } = await sb.from("app_images").delete().eq("key", key);
  return error ? { error: error.message } : {};
}
