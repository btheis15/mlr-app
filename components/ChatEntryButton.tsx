"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";

/**
 * The committee-page entry into its chat. Links STRAIGHT to the committee's own
 * chat route (`/committees/<slug>/chat`, which opens the General channel and
 * whose header "‹" returns here) — NOT through `/posts?c=<slug>`, which lands on
 * the all-chats list first and then jumps into the room (a visible flash, and a
 * Back that wrongly returned to the chats list).
 *
 * The unread badge reflects the GENERAL channel — the channel this button opens
 * — using the per-channel read model (committee_area_reads, area '' = General,
 * migration 0063). The old count read the pre-0063 committee_reads table and
 * summed every channel against one stale timestamp, so "N new" never matched
 * what you saw on arrival. Role-channel unread still surfaces per-channel in the
 * Feed → Chats list. RLS gates the count, so a non-member simply sees 0.
 */

// Stale-while-revalidate cache so the badge doesn't pop in on every revisit.
// Empty at module-eval + null user during prerender ⇒ cold render is 0 (the
// prior default), matching the static/SSR HTML; only ever written in the effect.
const unreadEntryCache = new Map<string, number>();

export function ChatEntryButton({ slug, name }: { slug: string; name: string }) {
  const { user, previewAsId } = useIdentity();
  const cacheKey = `${slug}|${user?.email ?? "guest"}|${previewAsId ?? "self"}`;
  const [unread, setUnread] = useState(unreadEntryCache.get(cacheKey) ?? 0);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !user) return;
    let cancelled = false;
    (async () => {
      const { data: c } = await sb.from("committees").select("id").eq("slug", slug).maybeSingle();
      const cid = (c as { id: string } | null)?.id;
      if (!cid) return;
      const me = previewAsId ?? (await sb.auth.getUser()).data.user?.id;
      if (!me) return;
      // General-channel unread: messages from others newer than my last read of
      // the General channel (committee_area_reads keys General as area '').
      const { data: rd } = await sb
        .from("committee_area_reads")
        .select("last_read_at")
        .eq("committee_id", cid)
        .eq("user_id", me)
        .eq("area", "")
        .maybeSingle();
      const since = (rd as { last_read_at: string } | null)?.last_read_at;
      let q = sb
        .from("committee_messages")
        .select("id", { count: "exact", head: true })
        .eq("committee_id", cid)
        .is("area", null)
        .neq("author_id", me);
      if (since) q = q.gt("created_at", since);
      const { count } = await q;
      if (!cancelled) {
        setUnread(count ?? 0);
        unreadEntryCache.set(cacheKey, count ?? 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, user, previewAsId, cacheKey]);

  return (
    <Link
      href={`/committees/${slug}/chat`}
      className="press flex items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-3.5 text-white shadow-sm"
    >
      <span className="flex items-center gap-2 text-sm font-semibold">💬 Open {name} chat</span>
      <span className="flex items-center gap-2">
        {unread > 0 && (
          <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">{unread > 99 ? "99+" : unread} new</span>
        )}
        <span aria-hidden>›</span>
      </span>
    </Link>
  );
}
