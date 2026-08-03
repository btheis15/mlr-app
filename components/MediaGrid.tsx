"use client";

import { useState } from "react";
import { photoUrls, type Media } from "@/lib/media";
import { Lightbox } from "@/components/Lightbox";

// Shared photo/video renderer: a single item or a swipeable carousel, with photos
// opening full-screen in the Lightbox and videos playing inline. Extracted from
// the inline versions in PostsView so Posts, work items, and future surfaces share
// one renderer. Owns its own Lightbox state, so callers just pass `media`.

export function MediaGrid({ media }: { media: Media[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  if (!media.length) return null;
  return (
    <>
      <MediaCarousel media={media} onOpenPhoto={setLightbox} />
      {/* `photos` is this whole group, so the viewer swipes through the rest
          of the item's photos instead of making you close and reopen. */}
      {lightbox && (
        <Lightbox key={lightbox} url={lightbox} photos={photoUrls(media)} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function MediaCarousel({ media, onOpenPhoto }: { media: Media[]; onOpenPhoto?: (url: string) => void }) {
  const [active, setActive] = useState(0);
  if (media.length === 1) return <div className="mt-2"><MediaItem m={media[0]} onOpen={onOpenPhoto} /></div>;
  return (
    <div className="relative mt-2">
      <div
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-xl"
      >
        {media.map((m, i) => (
          <div key={i} className="w-full shrink-0 snap-center">
            <MediaItem m={m} onOpen={onOpenPhoto} />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
        {media.map((_, i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full ring-1 ring-black/10 ${i === active ? "bg-white" : "bg-white/50"}`} />
        ))}
      </div>
      <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">
        {active + 1}/{media.length}
      </div>
    </div>
  );
}

function MediaItem({ m, onOpen }: { m: Media; onOpen?: (url: string) => void }) {
  // Uniform square frame. Photos fill (cropped) but tap to see the whole image
  // full-screen; videos fit on black (never cropped) and play inline.
  if (m.type === "video") {
    return (
      <div className="aspect-square w-full overflow-hidden rounded-xl bg-black">
        <video src={m.url} controls playsInline className="h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen?.(m.url)}
      className="press block aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl bg-black/5"
      aria-label="View full photo"
    >
      {/* The tile renders the small mini-generated preview when there is one —
          the full-res file only loads once someone taps through to the
          Lightbox (still m.url there). Falls back to the full image for rows
          with no thumbnail yet (pre-migration, or generation failed). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.thumbnailUrl || m.url} alt="" className="h-full w-full object-cover" />
    </button>
  );
}
