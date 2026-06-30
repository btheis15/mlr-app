// Admin-managed site images (the Home logo, the Family Fest cover, …) — stored
// as URLs in the shared `app_images` table (migration 0054) so admins can swap
// them in-app and both web + iOS update together. Reads are public; the bundled
// /public asset is the fallback when a key is unset/unreachable.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** Known image keys → the bundled fallback served from /public. */
export const SITE_IMAGE_FALLBACK: Record<string, string> = {
  home_logo: "/brand-logo-green.png",
  fest_cover: "/family-fest-2026.jpg",
};

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
