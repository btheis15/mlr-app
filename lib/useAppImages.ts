"use client";

// Client hook for the admin-managed site images (see lib/appImages.ts). Rides
// the shared SWR cache (memory across remounts + a persisted on-device copy,
// so images resolve instantly on a cold open too) and revalidates in the
// background; callers resolve a key with siteImageSrc(), which falls back to
// the bundled /public asset when the key is unset.

import { useCachedResource } from "@/lib/swrCache";
import { fetchAppImages } from "@/lib/appImages";

const EMPTY_MAP: Record<string, string> = {};

export function useAppImages(): Record<string, string> {
  const { data } = useCachedResource<Record<string, string>>(
    "appImages",
    EMPTY_MAP,
    fetchAppImages,
    { persist: "local" },
  );
  return data;
}
