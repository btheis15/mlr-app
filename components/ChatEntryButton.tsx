"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";

/**
 * The committee-page entry into its chat. Always links through (the chat screen
 * itself handles sign-in / request-to-join for non-members); for members it
 * also shows an unread count — messages from others since their last_read_at
 * (committee_reads, migration 0014).
 */
export function ChatEntryButton({ slug, name }: { slug: string; name: string }) {
  const { user, isAdmin, previewAsId } = useIdentity();
  const [unread, setUnread] = useState(0);

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
      let member = isAdmin;
      if (!member) {
        const { data: m } = await sb.from("committee_members").select("user_id").eq("committee_id", cid).eq("user_id", me).maybeSingle();
        member = !!m;
      }
      if (!member) return;
      const { data: rd } = await sb.from("committee_reads").select("last_read_at").eq("committee_id", cid).eq("user_id", me).maybeSingle();
      const since = (rd as { last_read_at: string } | null)?.last_read_at;
      let q = sb.from("committee_messages").select("id", { count: "exact", head: true }).eq("committee_id", cid).neq("author_id", me);
      if (since) q = q.gt("created_at", since);
      const { count } = await q;
      if (!cancelled) setUnread(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, user, isAdmin, previewAsId]);

  return (
    <Link
      href={`/posts?c=${slug}`}
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
