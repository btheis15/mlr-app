"use client";

import { useEffect, useState } from "react";
import { MEDIA_URL } from "@/lib/media";
import { useAppImages } from "@/lib/useAppImages";
import { mediaSrc } from "@/lib/mediaToken";

// Family Fest cover photo.
//
// Priority: THIS YEAR's own cover (`fest_config.cover_url`, migration 0219,
// editable in the Planner → Look) → the app-wide admin image
// (`app_images.fest_cover`) → the Mac-mini site-assets copy → the bundled
// /public copy, so the header never shows a broken image.
//
// ⚠️ The per-year cover is the FIRST link in that chain for a reason. Before
// 0219 the only place a cover could live was the single app-wide `fest_cover`
// key, which meant uploading next year's poster silently replaced the one the
// finished year's archive page shows — the archive's whole promise is that a
// past fest stays as it was. The app-wide key is kept as a fallback (it's still
// what an admin sets for "the Family Fest image" generally, and iOS reads it),
// so nothing that was already configured stops working.
const REMOTE = `${MEDIA_URL}/assets/site/family-fest-2026.jpg`;
const FALLBACK = "/family-fest-2026.jpg";

export function FestCover({ alt, coverUrl }: { alt: string; coverUrl?: string | null }) {
  const images = useAppImages();
  const yearCover = coverUrl?.trim() ? coverUrl.trim() : null;
  const preferred = yearCover ?? images["fest_cover"] ?? REMOTE;
  const [src, setSrc] = useState(preferred);

  // When the year's cover / admin image map loads (or changes), prefer it.
  useEffect(() => {
    setSrc(preferred);
  }, [preferred]);

  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-border shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaSrc(src)}
        alt={alt}
        className="block max-h-40 w-full object-cover"
        onError={() => {
          if (src !== FALLBACK) setSrc(FALLBACK);
        }}
      />
    </div>
  );
}
