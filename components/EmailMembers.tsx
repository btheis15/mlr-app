"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { EmailMembersComposer } from "@/components/EmailMembersComposer";
import { fetchAllRecipients, fetchCommitteeRecipients, fetchDirectoryRecipients } from "@/lib/emailBlast";

interface CommitteeOpt {
  id: string;
  name: string;
  emoji: string;
  position: number;
}

const PICK = "__pick"; // sentinel pool value for "Pick specific people"

/**
 * "Email members" — open to every signed-in member (Profile). Pick a pool, then
 * the composer takes over (email the whole pool or pick people from it):
 *   • Pick specific people — anyone, hand-picked from the member directory.
 *   • A committee you're in — its roster (admins see every committee).
 *   • Everyone (all members) — only if you're an App Admin OR in any committee,
 *     so the one-tap "everyone" stays with people who've shown they're involved.
 * The matching RPCs (migration 0031) re-check each gate server-side. Nothing is
 * sent from the app — it builds a `mailto:` and hands off to your mail app.
 */
export function EmailMembers() {
  const { user, isAdmin, previewAsId } = useIdentity();
  const [committees, setCommittees] = useState<CommitteeOpt[]>([]);
  const [canEveryone, setCanEveryone] = useState(false);
  const [pool, setPool] = useState<string>(PICK);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = supabase;
    if (!isSupabaseConfigured || !sb || !user) return;
    let cancelled = false;
    (async () => {
      const realId = (await sb.auth.getUser()).data.user?.id ?? "";
      // While an admin previews as a member, scope the committee options to THAT
      // member (isAdmin is already off in preview), so the preview only offers
      // the committees that member is actually in.
      const scopeId = previewAsId ?? realId;
      let opts: CommitteeOpt[] = [];
      let everyone = false;
      if (isAdmin) {
        // Admins can email any committee + everyone.
        const { data } = await sb.from("committees").select("id, name, emoji, position").order("position", { ascending: true });
        opts = (data ?? []) as CommitteeOpt[];
        everyone = true;
      } else {
        // Members: only the committees they're in (+ everyone if in any).
        const { data } = await sb
          .from("committee_members")
          .select("committees(id, name, emoji, position)")
          .eq("user_id", scopeId);
        // PostgREST returns the embedded committee as a to-one object, though
        // supabase-js types it as an array — normalize both shapes.
        const rows = (data ?? []) as unknown as { committees: CommitteeOpt | CommitteeOpt[] | null }[];
        opts = rows
          .map((r) => (Array.isArray(r.committees) ? r.committees[0] : r.committees))
          .filter((c): c is CommitteeOpt => !!c)
          .sort((a, b) => a.position - b.position);
        everyone = opts.length > 0;
      }
      if (cancelled) return;
      setCommittees(opts);
      setCanEveryone(everyone);
      // Default to the headline capability when available, else hand-pick.
      setPool(everyone ? "all" : PICK);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin, previewAsId]);

  if (!isSupabaseConfigured || !user || !ready) return null;

  const committee = committees.find((c) => c.id === pool);
  const isPick = pool === PICK;
  const isAll = pool === "all";

  const sourceKey = isPick ? "directory" : isAll ? "all" : `committee:${pool}`;
  const load = isPick
    ? fetchDirectoryRecipients
    : isAll
      ? fetchAllRecipients
      : () => fetchCommitteeRecipients(pool);
  const groupNoun = isPick ? "the people you pick" : isAll ? "all members" : committee ? committee.name : "this committee";

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 text-xs text-foreground/70 ring-1 ring-border">
        <span className="shrink-0 font-medium">Who to email</span>
        <select
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          className="min-w-0 flex-1 rounded-lg bg-card px-2 py-1.5 text-right text-xs ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value={PICK}>Pick specific people</option>
          {canEveryone && <option value="all">Everyone (all members)</option>}
          {committees.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </label>

      <EmailMembersComposer sourceKey={sourceKey} load={load} groupNoun={groupNoun} allowAll={!isPick} />
    </div>
  );
}
