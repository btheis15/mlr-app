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
/**
 * Stale-while-revalidate cache for the admin pending-request counts (mirrors
 * `eventsCache` in lib/hooks.ts). This component remounts every time Profile →
 * Admin is reopened; without this the per-committee counts reset to `{}` and
 * blank out until the refetch lands, so the request badges flicker away and pop
 * back. Holding the last map in memory lets a returning admin paint the badges
 * instantly while a background refetch keeps them current. Admin-only, global
 * (not per-viewer) data ⇒ a plain singleton. Memory-only (per session) and only
 * ever written *after* a client fetch — never during SSR/render — so it can't
 * change the server/first-paint output and can't cause a hydration mismatch (a
 * cold load starts with an empty cache, i.e. the original `{}` behavior).
 */
let adminCommitteesCache: Record<string, number> | null = null;

export function AdminCommittees() {
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, number>>(adminCommitteesCache ?? {}); // slug -> pending count

  // Deep-link from a "X asked to join <committee>" notification
  // (/admin/committees?committee=<slug>) — auto-expand that committee so its
  // join-request queue is right there instead of the admin having to find and
  // open it themselves. Reads window.location.search client-side (like
  // PostsView's ?post= deep link) rather than useSearchParams, which would
  // force a Suspense boundary under this app's static export.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const slug = new URLSearchParams(window.location.search).get("committee");
    if (!slug || !COMMITTEES.some((c) => c.slug === slug)) return;
    setOpen(slug);
    // Scroll it into view once expanded — a query-param arrival shouldn't
    // require the admin to also notice/scroll to which card opened.
    window.setTimeout(() => document.getElementById(`committee-${slug}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, []);

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
      adminCommitteesCache = counts;
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
    return <p className="px-1 text-xs text-muted">Committee management turns on once the backend is connected.</p>;
  }

  return (
    <div className="space-y-2">
      {COMMITTEES.map((c) => {
        const isOpen = open === c.slug;
        const count = pending[c.slug] ?? 0;
        return (
          <div key={c.slug} id={`committee-${c.slug}`} className="rounded-2xl bg-background ring-1 ring-border">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : c.slug)}
              aria-expanded={isOpen}
              className="press flex w-full items-center gap-3 p-3 text-left"
            >
              <span className="shrink-0 text-lg" aria-hidden>{c.emoji}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
              {count > 0 && (
                <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
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
