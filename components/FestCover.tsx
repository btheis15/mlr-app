"use client";

import { useEffect, useState } from "react";
import { MEDIA_URL } from "@/lib/media";
import { useAppImages } from "@/lib/useAppImages";

// Family Fest cover photo. Priority: the admin-set image (app_images.fest_cover,
// editable in the Planner / App Images) → the Mac-mini site-assets copy → the
// bundled /public copy, so the header never shows a broken image.
const REMOTE = `${MEDIA_URL}/assets/site/family-fest-2026.jpg`;
const FALLBACK = "/family-fest-2026.jpg";

export function FestCover({ alt }: { alt: string }) {
  const images = useAppImages();
  // Admin-set cover wins; else the mini copy (which itself falls back below).
  const preferred = images["fest_cover"] ?? REMOTE;
  const [src, setSrc] = useState(preferred);

  // When the admin image map loads (or changes), prefer it.
  useEffect(() => {
    setSrc(preferred);
  }, [preferred]);

  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-border shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="block w-full"
        onError={() => {
          if (src !== FALLBACK) setSrc(FALLBACK);
        }}
      />
    </div>
  );
}
