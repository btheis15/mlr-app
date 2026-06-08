"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchMyCommitteeRole } from "@/lib/roles";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { EmailMembersComposer } from "@/components/EmailMembersComposer";
import { fetchCommitteeRecipients } from "@/lib/emailBlast";

/**
 * "Email these members" on a committee page — shown to that committee's **Lead**
 * or an **app admin** (same gate as CommitteeMembers / migration 0015). They can
 * email the whole committee or pick specific people from it; emailing *all* app
 * members stays an app-admin tool (Profile → Admin tools). The
 * committee_member_recipients RPC re-checks the lead/admin gate server-side.
 */
export function CommitteeEmailMembers({ slug, name }: { slug: string; name: string }) {
  const { isAdmin } = useIdentity();
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const cid = await fetchCommitteeId(slug);
      if (!cid || cancelled) return;
      setCommitteeId(cid);
      const manage = isAdmin || (await fetchMyCommitteeRole(cid)) === "Lead";
      if (!cancelled) setCanManage(manage);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, isAdmin]);

  if (!isSupabaseConfigured || !canManage || !committeeId) return null;

  return (
    <CollapsibleSection title="Email these members" icon="✉️" subtitle={`Email ${name} — everyone or pick people`}>
      <EmailMembersComposer
        sourceKey={`committee:${committeeId}`}
        load={() => fetchCommitteeRecipients(committeeId)}
        groupNoun={name}
      />
    </CollapsibleSection>
  );
}
