"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchMyCommitteeRole } from "@/lib/roles";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { EmailMembersComposer } from "@/components/EmailMembersComposer";
import { fetchCommitteeRecipients } from "@/lib/emailBlast";

/**
 * "Email these members" on a committee page — shown to **any member of that
 * committee** (and app admins), per migration 0031 (was Lead/admin only). They
 * can email the whole committee or pick specific people from it. The
 * committee_member_recipients RPC re-checks the member gate server-side.
 */
export function CommitteeEmailMembers({ slug, name }: { slug: string; name: string }) {
  const { isAdmin, previewAsId } = useIdentity();
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [canEmail, setCanEmail] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      const cid = await fetchCommitteeId(slug);
      if (!cid || cancelled) return;
      setCommitteeId(cid);
      // Any member of this committee (fetchMyCommitteeRole != null) or an admin.
      // While previewing as a member, judge by THAT member's membership (isAdmin
      // is already off in preview), so a non-member preview can't email it.
      const ok = isAdmin || (await fetchMyCommitteeRole(cid, previewAsId ?? undefined)) !== null;
      if (!cancelled) setCanEmail(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, isAdmin, previewAsId]);

  if (!isSupabaseConfigured || !canEmail || !committeeId) return null;

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
