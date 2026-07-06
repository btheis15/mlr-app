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
 *
 * Stale-while-revalidate cache (mirrors `useEvents`/`eventsCache` in lib/hooks.ts):
 * this component remounts on every committee-page visit and the whole "Email these
 * members" section is gated on `canEmail`, so without a cache it re-resolves the
 * member gate from scratch each time and the section pops in after the async check.
 * Holding the last-resolved gate per key lets a returning visit paint the section
 * immediately while the effect re-checks in the background. Keyed by slug + the
 * identity that decides the gate (isAdmin + previewAsId), so a different viewer or
 * a preview switch never reuses another identity's verdict. Memory-only, written
 * ONLY after a client fetch (never at module-eval, never during render), so a cold
 * first render starts empty — identical to the original `false`/`null` default —
 * and can't cause a hydration mismatch. The background re-check always overwrites,
 * so a revoked gate (now a non-member) paints then correctly hides.
 */
const committeeEmailCache = new Map<string, { canEmail: boolean; committeeId: string | null }>();

export function CommitteeEmailMembers({ slug, name }: { slug: string; name: string }) {
  const { user, isAdmin, previewAsId } = useIdentity();
  // Key on the real viewer identity too — otherwise two different non-admin,
  // non-previewing members both hash to `slug|false|self` and one flashes the
  // other's "Email everyone" panel before the background fetch reconciles.
  const key = `${slug}|${user?.email ?? "guest"}|${isAdmin}|${previewAsId ?? "self"}`;
  const cached = committeeEmailCache.get(key);
  const [committeeId, setCommitteeId] = useState<string | null>(cached?.committeeId ?? null);
  const [canEmail, setCanEmail] = useState(cached?.canEmail ?? false);

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
      if (cancelled) return;
      // Cache the resolved gate (incl. a now-false one) so a return visit paints
      // immediately AND a revoked verdict can't stick.
      committeeEmailCache.set(key, { canEmail: ok, committeeId: cid });
      setCanEmail(ok);
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
