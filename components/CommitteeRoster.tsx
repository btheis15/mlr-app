"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { fetchProfiles, type ProfileLite } from "@/lib/roles";
import { nameMatches } from "@/lib/committees";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { PrivateName } from "@/components/Guard";
import { CommitteeBadge } from "@/components/CommitteeBadge";
import { CommitteeMemberContact } from "@/components/CommitteeMemberContact";
import { FAMILY_FEST_AREAS } from "@/lib/data";
import { fetchCommitteeRoster, type RosterEntry } from "@/lib/committeeRoster";
import type { Committee } from "@/lib/types";

/**
 * The public-facing committee roster. The roster itself is **static**
 * (lib/data `COMMITTEES`) so it can list people who don't have an account yet,
 * but each slot LINKS to a real account when one exists — matched by email
 * (`profiles.contact_email`, Supabase's seeded login email) with a name-match
 * fallback. A linked slot renders the account (avatar + current display name +
 * tap-through to the profile) instead of the placeholder, so a person upgrades
 * in place when they sign up — there's only ever one slot per person, no
 * duplicate. (This is separate from the lead/admin-only `CommitteeMembers`
 * management card above it, which controls Supabase chat membership.)
 */
export function CommitteeRoster({ committee }: { committee: Committee }) {
  // The roster is DB-backed (migration 0055) with the in-code list as a fallback;
  // each slot may carry a linked account (linked_user_id) stamped on verify.
  const [members, setMembers] = useState<RosterEntry[]>(
    () => (committee.members ?? []).map((m) => ({ ...m, linkedUserId: null, linkedName: null, linkedAvatarUrl: null })),
  );
  useEffect(() => {
    let alive = true;
    fetchCommitteeRoster(committee.slug).then((r) => alive && setMembers(r));
    return () => {
      alive = false;
    };
  }, [committee.slug]);

  const isRoleBased = members.some((m) => m.roles && m.roles.length > 0);

  // Distinct, lowercased roster emails — the keys we resolve to real accounts.
  const rosterEmails = useMemo(
    () => Array.from(new Set(members.map((m) => m.email?.toLowerCase()).filter((e): e is string => !!e))),
    [members],
  );

  const [allProfiles, setAllProfiles] = useState<ProfileLite[]>([]);
  const [byEmail, setByEmail] = useState<Record<string, ProfileLite>>({});
  const [sheet, setSheet] = useState<{ id: string; name: string; avatar: string | null } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let alive = true;
    (async () => {
      // All profiles (id/name/avatar — public) power the name-match fallback;
      // a scoped email query (only the roster's emails) is the exact link key.
      const all = await fetchProfiles();
      const map: Record<string, ProfileLite> = {};
      if (supabase && rosterEmails.length) {
        const { data } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url, contact_email")
          .in("contact_email", rosterEmails);
        for (const p of (data ?? []) as { id: string; display_name: string | null; avatar_url: string | null; contact_email: string | null }[]) {
          const e = (p.contact_email ?? "").toLowerCase();
          if (e) map[e] = { id: p.id, name: p.display_name?.trim() || "Member", avatarUrl: p.avatar_url ?? null };
        }
      }
      if (alive) {
        setAllProfiles(all);
        setByEmail(map);
      }
    })();
    return () => {
      alive = false;
    };
  }, [rosterEmails]);

  const linkFor = (m: RosterEntry): ProfileLite | null => {
    // The DB link (stamped on verify) is authoritative; fall back to live email /
    // name matching so it still resolves before a backfill or for seed data.
    if (m.linkedUserId) {
      return { id: m.linkedUserId, name: m.linkedName ?? m.name, avatarUrl: m.linkedAvatarUrl ?? null };
    }
    const e = m.email?.toLowerCase();
    if (e && byEmail[e]) return byEmail[e];
    return allProfiles.find((p) => nameMatches(m.name, p.name)) ?? null;
  };

  // Empty roster → render nothing (so an empty static list never shows a
  // misleading "no members" next to the account-membership card above).
  if (members.length === 0) return null;

  const Row = ({ m, isLead }: { m: RosterEntry; isLead?: boolean }) => {
    const link = linkFor(m);
    const display = link?.name ?? m.name;
    // Invited (has an email) but hasn't claimed the slot by verifying yet.
    const pending = !link && !!m.email;
    return (
      <li className="flex items-center gap-2">
        {link ? (
          <button
            type="button"
            onClick={() => setSheet({ id: link.id, name: link.name, avatar: link.avatarUrl })}
            className="press flex min-w-0 items-center gap-2 text-left"
          >
            <Avatar name={link.name} url={link.avatarUrl} size={26} />
            <span className="truncate text-sm font-medium"><PrivateName name={display} /></span>
          </button>
        ) : (
          <span className="truncate text-sm"><PrivateName name={display} /></span>
        )}
        <CommitteeBadge name={display} />
        {isLead && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">Lead</span>
        )}
        {pending && (
          <span
            className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-foreground/55"
            title="Invited — hasn't signed in to claim their account yet"
          >
            Pending verification
          </span>
        )}
        <span className="ml-auto">
          <CommitteeMemberContact email={m.email} phone={m.phone} />
        </span>
      </li>
    );
  };

  return (
    <>
      {isRoleBased ? (
        // Role-based committee (Family Fest): grouped by area, Lead pinned on top.
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Roles &amp; who&rsquo;s on them</h2>
          {FAMILY_FEST_AREAS.map((area) => {
            const inArea = members
              .map((m) => ({ m, lead: m.roles?.includes(`${area} · Lead`) ?? false }))
              .filter(({ m }) => m.roles?.some((r) => r === area || r === `${area} · Lead`))
              .sort((a, b) => Number(b.lead) - Number(a.lead));
            if (!inArea.length) return null;
            const lead = inArea.find((x) => x.lead);
            return (
              <div key={area} className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{area}</h3>
                  {lead && (
                    <span className="shrink-0 text-[11px] text-foreground/50">
                      Lead: <span className="font-semibold text-primary"><PrivateName name={lead.m.name} /></span>
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {inArea.map(({ m, lead: isLead }) => (
                    <Row key={m.name} m={m} isLead={isLead} />
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">Members</h2>
          <ul className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-border">
            {members.map((m) => (
              <Row key={m.name} m={m} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-foreground/40">
        Contact buttons + profile links appear as members link their accounts.
      </p>

      {sheet && (
        <MemberSheet
          key={sheet.id}
          id={sheet.id}
          name={sheet.name}
          avatarUrl={sheet.avatar}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
