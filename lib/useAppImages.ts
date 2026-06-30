"use client";

// Client hook for the admin-managed site images (see lib/appImages.ts). Fetches
// the URL map once (module-cached so a re-mount paints instantly) and returns it;
// callers resolve a key with siteImageSrc(), which falls back to the bundled
// /public asset when the key is unset.

import { useEffect, useState } from "react";
import { fetchAppImages } from "@/lib/appImages";

let cache: Record<string, string> | null = null;

export function useAppImages(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>(cache ?? {});

  useEffect(() => {
    let active = true;
    fetchAppImages().then((m) => {
      if (active) {
        setMap(m);
        cache = m;
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return map;
}
