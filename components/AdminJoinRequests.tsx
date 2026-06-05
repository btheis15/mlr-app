"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { useBusyAction, useManagedCommittee } from "@/lib/hooks";

/**
 * The pending join-request queue for one committee, shown to whoever can manage
 * it — an **app admin** or this committee's **Lead** (migration 0015). Approve
 * adds the member (and drops them straight into the chat, live); reject closes
 * the request. Renders nothing for everyone else or when nothing's pending, so
 * it's safe to drop onto the committee page. Backed by review_join_request().
 */
interface Req {
  id: string;
  userId: string;
  name: string;
  avatar?: string | null;
  message?: string | null;
}

export function AdminJoinRequests({ slug, name }: { slug: string; name: string }) {
  const [reqs, setReqs] = useState<Req[]>([]);
  const { busy, run } = useBusyAction();

  const load = async (cid: string) => {
    const sb = supabase;
    if (!sb) return;
    const { data } = await sb
      .from("committee_join_requests")
      .select("id, user_id, message, created_at")
      .eq("committee_id", cid)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as { id: string; user_id: string; message: string | null }[];
    if (!rows.length) {
      setReqs([]);
      return;
    }
    const { data: profs } = await sb.from("profiles").select("id, display_name, avatar_url").in("id", rows.map((r) => r.user_id));
    const pm = new Map((profs ?? []).map((p) => [(p as { id: string }).id, p as { display_name: string | null; avatar_url: string | null }]));
    setReqs(rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: pm.get(r.user_id)?.display_name?.trim() || "Member",
      avatar: pm.get(r.user_id)?.avatar_url ?? null,
      message: r.message,
    })));
  };

  const { committeeId, canManage } = useManagedCommittee(slug, { watch: "committee_join_requests", load });

  const review = (reqId: string, approve: boolean) =>
    run(reqId, async () => {
      if (!supabase || !committeeId) return;
      await supabase.rpc("review_join_request", { req_id: reqId, approve });
      await load(committeeId);
    });

  if (!canManage || !isSupabaseConfigured || reqs.length === 0) return null;

  return (
    <section className="space-y-2 rounded-2xl bg-accent/5 p-4 ring-1 ring-accent/20">
      <h2 className="text-sm font-semibold text-accent">🛡️ {name} join requests ({reqs.length})</h2>
      <ul className="space-y-2">
        {reqs.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-border">
            <Avatar name={r.name} url={r.avatar} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.name}</p>
              {r.message && <p className="truncate text-xs text-foreground/55">{r.message}</p>}
            </div>
            <button disabled={busy === r.id} onClick={() => review(r.id, true)} className="press shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              Approve
            </button>
            <button disabled={busy === r.id} onClick={() => review(r.id, false)} className="press shrink-0 rounded-full px-2 py-1.5 text-xs font-medium text-foreground/50 disabled:opacity-50">
              Reject
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
