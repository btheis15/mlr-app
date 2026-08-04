"use client";

import Link from "next/link";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";
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

export function ChatEntryButton({
  slug,
  name,
  variant = "bar",
}: {
  slug: string;
  name: string;
  /** `"tile"` renders a square-ish grid tile (the committee page's action grid);
   *  `"bar"` is the original full-width row, still used elsewhere. */
  variant?: "bar" | "tile";
}) {
  const { user, userId, previewAsId } = useIdentity();
  const me = previewAsId ?? userId;
  // Shared SWR cache (persisted per uid+slug) so the badge paints its
  // last-known count instantly instead of popping in; the revalidate brings it
  // current. Previews stay memory-only.
  const { data: unread } = useCachedResource<number>(
    user && me
      ? previewAsId
        ? `chatEntry.preview.${previewAsId}.${slug}`
        : `chatEntry.${me}.${slug}`
      : null,
    0,
    async () => {
      const sb = supabase;
      if (!isSupabaseConfigured || !sb || !me) return 0;
      const { data: c } = await sb.from("committees").select("id").eq("slug", slug).maybeSingle();
      const cid = (c as { id: string } | null)?.id;
      if (!cid) return 0;
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
      return count ?? 0;
    },
    { persist: previewAsId ? undefined : "local" },
  );

  const badge = unread > 0 ? (unread > 99 ? "99+" : String(unread)) : null;

  if (variant === "tile") {
    return (
      <Link
        href={`/committees/${slug}/chat`}
        className="press relative flex min-h-[68px] flex-col justify-between rounded-2xl bg-primary p-3 text-white shadow-sm"
      >
        <span aria-hidden className="text-lg leading-none">💬</span>
        <span className="text-sm font-semibold leading-tight">Committee chat</span>
        {badge && (
          <span className="absolute right-2 top-2 rounded-full bg-white/25 px-1.5 py-0.5 text-[11px] font-bold">
            {badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href={`/committees/${slug}/chat`}
      className="press flex items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-3.5 text-white shadow-sm"
    >
      <span className="flex items-center gap-2 text-sm font-semibold">💬 Open {name} chat</span>
      <span className="flex items-center gap-2">
        {badge && <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">{badge} new</span>}
        <span aria-hidden>›</span>
      </span>
    </Link>
  );
}
