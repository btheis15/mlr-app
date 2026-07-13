"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";
import { fetchProfiles, profileMap } from "@/lib/roles";
import { useBusyAction, useManagedCommittee } from "@/lib/hooks";

/**
 * The pending join-request queue for one committee, shown to whoever can manage
 * it — an **app admin** or this committee's **Lead** (migration 0015). Approve
 * adds the member (and drops them straight into the chat, live); reject closes
 * the request. Shows the requested area (migration 0051) when the requester
 * picked one. Renders nothing for everyone else or when nothing's pending.
 */
interface Req {
  id: string;
  userId: string;
  name: string;
  avatar?: string | null;
  message?: string | null;
  requestedAreas: string[];
}

export function AdminJoinRequests({ slug, name }: { slug: string; name: string }) {
  const [reqs, setReqs] = useState<Req[]>([]);
  const { busy, run } = useBusyAction();

  const load = async (cid: string) => {
    const sb = supabase;
    if (!sb) return;
    const { data } = await sb
      .from("committee_join_requests")
      .select("id, user_id, message, requested_area, requested_areas, created_at")
      .eq("committee_id", cid)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as {
      id: string;
      user_id: string;
      message: string | null;
      requested_area: string | null;
      requested_areas: string[] | null;
    }[];
    if (!rows.length) {
      setReqs([]);
      return;
    }
    const pm = profileMap(await fetchProfiles(rows.map((r) => r.user_id)));
    setReqs(
      rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: pm.get(r.user_id)?.name || "Member",
        avatar: pm.get(r.user_id)?.avatarUrl ?? null,
        message: r.message,
        // Prefer the array; fall back to the legacy single column.
        requestedAreas:
          r.requested_areas && r.requested_areas.length
            ? r.requested_areas
            : r.requested_area
              ? [r.requested_area]
              : [],
      })),
    );
  };

  const { committeeId, canManage } = useManagedCommittee(slug, {
    watch: "committee_join_requests",
    load,
  });

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
              {r.requestedAreas.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {r.requestedAreas.map((area) => (
                    <span
                      key={area}
                      className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                    >
                      {area}
                    </span>
                  ))}
                </div>
              ) : r.message ? (
                <p className="truncate text-xs text-muted">{r.message}</p>
              ) : null}
            </div>
            <button
              disabled={busy === r.id}
              onClick={() => review(r.id, true)}
              className="press shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={busy === r.id}
              onClick={() => review(r.id, false)}
              className="press shrink-0 rounded-full px-2 py-1.5 text-xs font-medium text-foreground/50 disabled:opacity-50"
            >
              Reject
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
