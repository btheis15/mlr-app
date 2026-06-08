"use client";

import { useState } from "react";
import { MEDIA_URL } from "@/lib/media";

// Family Fest cover photo. Served from the Mac-mini media server's site-assets
// folder (media-server/assets/site/) so it isn't bundled into the app or mixed
// in with member Feed media. If the mini copy is ever missing/unreachable, we
// fall back to the bundled /public copy so the header never shows a broken image.
const REMOTE = `${MEDIA_URL}/assets/site/family-fest-2026.jpg`;
const FALLBACK = "/family-fest-2026.jpg";

export function FestCover({ alt }: { alt: string }) {
  const [src, setSrc] = useState(REMOTE);
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
