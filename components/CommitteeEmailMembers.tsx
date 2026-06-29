"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeId, fetchMyCommitteeRole } from "@/lib/roles";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { EmailMembersComposer } from "@/components/EmailMembersComposer";
import { fetchCommitteeRecipients, type RecipientResult } from "@/lib/emailBlast";
import { COMMITTEES } from "@/lib/data";
import { nameMatches } from "@/lib/committees";

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

  // Enrich DB recipients with roles from the static committee roster so the
  // composer can offer a "By Role" filter (Family Fest areas, etc.).
  const load = async (): Promise<RecipientResult> => {
    const result = await fetchCommitteeRecipients(committeeId);
    const committee = COMMITTEES.find((c) => c.slug === slug);
    const roleMembers = committee?.members.filter((m) => m.roles?.length);
    if (!roleMembers?.length) return result;
    const enriched = result.recipients.map((r) => {
      const match = roleMembers.find((m) => nameMatches(m.name, r.name));
      return match?.roles?.length ? { ...r, roles: match.roles } : r;
    });
    return { ...result, recipients: enriched };
  };

  return (
    <CollapsibleSection title="Email these members" icon="✉️" subtitle={`Email ${name} — everyone, by role, or pick people`}>
      <EmailMembersComposer
        sourceKey={`committee:${committeeId}`}
        load={load}
        groupNoun={name}
      />
    </CollapsibleSection>
  );
}
