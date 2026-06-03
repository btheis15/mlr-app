"use client";

import { useEffect, useState } from "react";
import { COMMITTEES } from "@/lib/data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { AdminJoinRequests } from "@/components/AdminJoinRequests";
import { CommitteeMembers } from "@/components/CommitteeMembers";

/**
 * App-admin overview of every committee, in one place (Profile → Admin →
 * Committees): who's in each, plus the pending join-request queue. Each
 * committee is a lazy disclosure — its roster + requests (the same controls as
 * the committee page, reused) mount only when expanded — and a badge flags
 * committees that have pending requests so they're easy to spot.
 */
export function AdminCommittees() {
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, number>>({}); // slug -> pending count

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb) return;
    let cancelled = false;
    const loadCounts = async () => {
      const [{ data: cs }, { data: reqs }] = await Promise.all([
        sb.from("committees").select("id, slug"),
        sb.from("committee_join_requests").select("committee_id").eq("status", "pending"),
      ]);
      if (cancelled) return;
      const idToSlug = new Map(((cs ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
      const counts: Record<string, number> = {};
      for (const r of (reqs ?? []) as { committee_id: string }[]) {
        const slug = idToSlug.get(r.committee_id);
        if (slug) counts[slug] = (counts[slug] ?? 0) + 1;
      }
      setPending(counts);
    };
    loadCounts();
    const ch = sb
      .channel("admin-committee-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "committee_join_requests" }, () => loadCounts())
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(ch);
    };
  }, []);

  if (!isSupabaseConfigured) {
    return <p className="px-1 text-xs text-foreground/50">Committee management turns on once the backend is connected.</p>;
  }

  return (
    <div className="space-y-2">
      {COMMITTEES.map((c) => {
        const isOpen = open === c.slug;
        const count = pending[c.slug] ?? 0;
        return (
          <div key={c.slug} className="rounded-2xl bg-background ring-1 ring-border">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : c.slug)}
              aria-expanded={isOpen}
              className="press flex w-full items-center gap-3 p-3 text-left"
            >
              <span className="shrink-0 text-lg" aria-hidden>{c.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
              {count > 0 && (
                <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">
                  {count} request{count === 1 ? "" : "s"}
                </span>
              )}
              <span className={`shrink-0 text-foreground/40 transition-transform duration-[var(--dur-tap)] ease-[var(--ease-spring)] ${isOpen ? "rotate-90" : ""}`} aria-hidden>›</span>
            </button>
            {isOpen && (
              <div className="space-y-2 px-3 pb-3">
                <AdminJoinRequests slug={c.slug} name={c.name} />
                <CommitteeMembers slug={c.slug} name={c.name} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
