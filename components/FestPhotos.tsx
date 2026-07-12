"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useFestContent } from "@/lib/useFestContent";
import { Lightbox } from "@/components/Lightbox";

/**
 * Family Fest Photos — a photo-first wall of everything the family posted
 * around fest week. There is no separate "fest photos" table: photos ARE feed
 * posts (Posts tab), so this view reads the same `posts` + `post_media` rows
 * and keeps the ones whose timeline anchor (`occurred_at`, falling back to
 * `created_at`) lands inside the fest window — a week before the start (early
 * arrivals) through three weeks after the end (the wrap-phase "post the photos
 * you didn't get to" tail). Posting/commenting stays in the Feed; this is the
 * fest-flavored album view of it.
 *
 * Members-only: the page wraps this in SignInWall (posts are members-only in
 * the DB since the 0081 RLS lockdown, so a guest query would come back empty
 * anyway — the wall gives them the friendly sign-in card instead of a false
 * "no photos"). With no backend configured it degrades to the empty state.
 */

/** Legacy Supabase Storage bucket (pre-mini uploads) — display-only, mirrors PostsView. */
const BUCKET = "post-photos";

/** Fest photo window: startDate − LEAD_DAYS through endDate + TAIL_DAYS (inclusive). */
const LEAD_DAYS = 7;
const TAIL_DAYS = 21;

interface PostRow {
  id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  occurred_at?: string | null;
  status?: string | null;
}
interface MediaRow {
  post_id: string;
  storage_path: string;
  media_type: string;
  position: number;
}

interface PhotoItem {
  key: string;
  url: string;
  type: "image" | "video";
  caption?: string;
}

export function FestPhotos() {
  const { config } = useFestContent();
  const { startDate, endDate } = config;
  // null = still loading (skeleton); [] = genuinely nothing (empty state).
  const [items, setItems] = useState<PhotoItem[] | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) {
      // No backend — nothing to query; show the friendly empty state.
      setItems([]);
      return;
    }
    (async () => {
      try {
        // Posts: prefer occurred_at (timeline anchor) + status (moderation);
        // degrade column-by-column pre-migration, same ladder as PostsView.
        let rows: PostRow[] = [];
        const full = await sb
          .from("posts")
          .select("id, text, image_path, created_at, occurred_at, status")
          .order("occurred_at", { ascending: false });
        if (!full.error) {
          rows = (full.data ?? []) as PostRow[];
        } else {
          const noStatus = await sb
            .from("posts")
            .select("id, text, image_path, created_at, occurred_at")
            .order("occurred_at", { ascending: false });
          if (!noStatus.error) {
            rows = (noStatus.data ?? []) as PostRow[];
          } else {
            const base = await sb
              .from("posts")
              .select("id, text, image_path, created_at")
              .order("created_at", { ascending: false });
            rows = (base.data ?? []) as PostRow[];
          }
        }

        const mediaRes = await sb
          .from("post_media")
          .select("post_id, storage_path, media_type, position")
          .order("position", { ascending: true });

        if (!active) return;

        // The fest window, in local time (dates are plain ISO days).
        const windowStart = new Date(`${startDate}T00:00:00`);
        windowStart.setDate(windowStart.getDate() - LEAD_DAYS);
        const windowEnd = new Date(`${endDate}T23:59:59.999`);
        windowEnd.setDate(windowEnd.getDate() + TAIL_DAYS);

        const mediaByPost: Record<string, { url: string; type: "image" | "video" }[]> = {};
        for (const m of ((mediaRes.data ?? []) as MediaRow[])) {
          (mediaByPost[m.post_id] ||= []).push({
            url: m.storage_path.startsWith("http")
              ? m.storage_path
              : sb.storage.from(BUCKET).getPublicUrl(m.storage_path).data.publicUrl,
            type: m.media_type === "video" ? "video" : "image",
          });
        }

        const flat: PhotoItem[] = [];
        for (const r of rows) {
          // RLS already keeps non-visible rows to their author/admins; this
          // client check just keeps a held post's photos out of THEIR album too.
          if ((r.status ?? "visible") !== "visible") continue;
          const ts = new Date(r.occurred_at || r.created_at);
          if (Number.isNaN(ts.getTime()) || ts < windowStart || ts > windowEnd) continue;
          const media =
            mediaByPost[r.id] ??
            (r.image_path
              ? [
                  {
                    url: sb.storage.from(BUCKET).getPublicUrl(r.image_path).data.publicUrl,
                    type: "image" as const,
                  },
                ]
              : []);
          const caption = r.text?.trim() || undefined;
          media.forEach((m, i) => flat.push({ key: `${r.id}-${i}`, url: m.url, type: m.type, caption }));
        }
        setItems(flat);
      } catch {
        if (active) setItems([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [startDate, endDate]);

  // Loading — a quiet skeleton grid so the wall doesn't flash empty.
  if (items === null) {
    return (
      <div className="grid grid-cols-3 gap-1.5" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-xl bg-card ring-1 ring-border" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-3xl">
          📸
        </div>
        <p className="text-sm font-semibold">No photos yet — post some from the Feed! 📸</p>
        <p className="text-xs text-foreground/60">
          Anything posted to the Feed around fest week shows up here automatically.
        </p>
        <Link
          href="/posts"
          className="press inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-white"
        >
          Go to the Feed
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((it) =>
          it.type === "video" ? (
            <video
              key={it.key}
              src={it.url}
              controls
              playsInline
              preload="metadata"
              className="aspect-square w-full rounded-xl bg-black object-cover"
            />
          ) : (
            <button
              key={it.key}
              type="button"
              onClick={() => setLightbox(it.url)}
              aria-label={it.caption ? `View photo: ${it.caption}` : "View full photo"}
              className="press relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl bg-black/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt={it.caption ?? ""} loading="lazy" className="h-full w-full object-cover" />
              {it.caption && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-medium text-white">
                  {it.caption}
                </span>
              )}
            </button>
          ),
        )}
      </div>

      <Link
        href="/posts"
        className="press block rounded-2xl bg-card p-4 text-center text-sm font-semibold text-primary ring-1 ring-border"
      >
        📸 Add yours from the Feed →
      </Link>

      {lightbox && <Lightbox key={lightbox} url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
