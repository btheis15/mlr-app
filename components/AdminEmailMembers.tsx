"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { EmailMembersComposer } from "@/components/EmailMembersComposer";
import { fetchAllRecipients, fetchCommitteeRecipients } from "@/lib/emailBlast";

interface CommitteeOpt {
  id: string;
  name: string;
  emoji: string;
}

/**
 * Admin "Email members" tool (Profile → Admin tools). **App admins only.** Pick
 * a pool — everyone, or one committee — then the composer takes over (email the
 * whole group, or pick specific people). Maps to the three asks: all members
 * (Everyone + "everyone"), a committee (pick it + "everyone"), and a custom set
 * (any pool + "pick specific"). Committee Leads get the committee-scoped version
 * on the committee page instead (CommitteeEmailMembers).
 */
export function AdminEmailMembers() {
  const { isAdmin } = useIdentity();
  const [committees, setCommittees] = useState<CommitteeOpt[]>([]);
  const [pool, setPool] = useState<string>("all"); // "all" | committee id

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let cancelled = false;
    sb.from("committees")
      .select("id, name, emoji")
      .order("position", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setCommittees((data ?? []) as CommitteeOpt[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // App admins only (the RPCs enforce it server-side too).
  if (isSupabaseConfigured && !isAdmin) return null;

  const committee = committees.find((c) => c.id === pool);
  const sourceKey = pool === "all" ? "all" : `committee:${pool}`;
  const load = pool === "all" ? fetchAllRecipients : () => fetchCommitteeRecipients(pool);
  const groupNoun = pool === "all" ? "all members" : committee ? committee.name : "this committee";

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
        <span className="shrink-0 font-medium">Who to email</span>
        <select
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          className="min-w-0 flex-1 rounded-lg bg-card px-2 py-1.5 text-right text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">Everyone (all members)</option>
          {committees.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </label>

      <EmailMembersComposer sourceKey={sourceKey} load={load} groupNoun={groupNoun} />
    </div>
  );
}
