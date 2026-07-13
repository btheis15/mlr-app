"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

// Same bucket PostsView resolves post photos from (components/PostsView.tsx).
const BUCKET = "post-photos";
// A memory counts within this many days of today's month-day, either side.
const WINDOW_DAYS = 3;
const YEAR_LEN = 365;

interface Memory {
  id: string;
  year: number;
  caption: string;
  thumbUrl: string;
}

interface PostRow {
  id: string;
  text: string | null;
  image_path: string | null;
  created_at: string;
  occurred_at?: string;
  status?: string;
}

interface MediaRow {
  post_id: string;
  storage_path: string;
  media_type: string;
  position: number;
}

/** Posts, tolerant of pre-migration columns — mirrors PostsView's fallback
 *  chain (occurred_at from migration 0005, status from migration 0040) so this
 *  card still works if either hasn't been applied yet. */
async function fetchPostsTolerant(sb: NonNullable<typeof supabase>): Promise<PostRow[]> {
  const withOcc = await sb
    .from("posts")
    .select("id, text, image_path, created_at, occurred_at, status")
    .order("occurred_at", { ascending: false });
  if (!withOcc.error) return (withOcc.data ?? []) as unknown as PostRow[];
  const base = await sb.from("posts").select("id, text, image_path, created_at").order("created_at", { ascending: false });
  return ((base.data ?? []) as unknown as { id: string; text: string | null; image_path: string | null; created_at: string }[]).map(
    (r) => ({ ...r, occurred_at: r.created_at, status: "visible" }),
  );
}

/** A date's LOCAL day-of-year in a fixed non-leap reference year, for a
 *  year-agnostic month-day compare (Feb-29 lands adjacent to Mar 1 — close
 *  enough for a ±3-day window). Uses local calendar components throughout
 *  (never UTC) so it matches the viewer's own "today", same as
 *  lib/format.ts's `dayKey`. */
function dayOfYear(d: Date): number {
  const ref = new Date(2001, d.getMonth(), d.getDate()).getTime();
  const start = new Date(2001, 0, 1).getTime();
  return Math.round((ref - start) / 86_400_000);
}

/** Shortest distance between two day-of-year values, wrapping at year end
 *  (so Dec 30 and Jan 2 read as 3 days apart, not 363). */
function circularDayDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, YEAR_LEN - diff);
}

/**
 * Members-only "on this day" memory — a photo post from a prior year within
 * ±3 days of today's month-day. Reads `posts` + the first `post_media` row per
 * post, resolving storage paths to public URLs the same way PostsView /
 * FestPhotos do (the `post-photos` Storage bucket, or a raw http(s) URL /
 * legacy `image_path` passed through as-is). The pick is DETERMINISTIC — day
 * of year `%` the candidate count, not random — so it's stable for everyone
 * looking on the same day (and rotates naturally as the candidate pool
 * changes year to year). Tapping deep-links to `/posts?post=<id>`, the same
 * scroll-to-and-flash convention PostsView already reads on load. Null for
 * guests, or when there's no candidate (no prior-year post with a photo in the
 * window, or the tables aren't reachable yet) — never an error state.
 *
 * Usage: `<OnThisDayCard />` — anywhere on Home, members-only (self-hides for
 * guests).
 */
export function OnThisDayCard() {
  const { user } = useIdentity();
  const [memory, setMemory] = useState<Memory | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMemory(null);
    const sb = supabase;
    if (!user || !isSupabaseConfigured || !sb) return;
    (async () => {
      try {
        const [posts, mediaRes] = await Promise.all([
          fetchPostsTolerant(sb),
          sb.from("post_media").select("post_id, storage_path, media_type, position").order("position", { ascending: true }),
        ]);

        const firstImageByPost = new Map<string, string>();
        for (const m of (mediaRes.data ?? []) as unknown as MediaRow[]) {
          if (m.media_type === "video" || firstImageByPost.has(m.post_id)) continue;
          firstImageByPost.set(m.post_id, m.storage_path);
        }

        const resolveUrl = (path: string) =>
          path.startsWith("http") ? path : sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

        const now = new Date();
        const currentYear = now.getFullYear();
        const todayDoy = dayOfYear(now);

        const candidates: Memory[] = [];
        for (const p of posts) {
          if (p.status && p.status !== "visible") continue;
          const occurred = p.occurred_at || p.created_at;
          const d = new Date(occurred);
          if (Number.isNaN(d.getTime()) || d.getFullYear() >= currentYear) continue;
          if (circularDayDistance(dayOfYear(d), todayDoy) > WINDOW_DAYS) continue;
          const path = firstImageByPost.get(p.id) || (p.image_path ?? null);
          if (!path) continue; // "a photo memory" — skip posts with no image
          candidates.push({
            id: p.id,
            year: d.getFullYear(),
            caption: p.text?.trim() || "A memory from back then.",
            thumbUrl: resolveUrl(path),
          });
        }
        if (!candidates.length) {
          if (!cancelled) setMemory(null);
          return;
        }
        candidates.sort((a, b) => a.id.localeCompare(b.id)); // stable order for the deterministic pick
        const pick = candidates[todayDoy % candidates.length];
        if (!cancelled) setMemory(pick);
      } catch {
        if (!cancelled) setMemory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || !memory) return null;

  return (
    <Link href={`/posts?post=${memory.id}`} className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={memory.thumbUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">On this day in {memory.year}</p>
        <p className="mt-0.5 truncate text-xs text-foreground/60">{memory.caption}</p>
      </div>
    </Link>
  );
}
