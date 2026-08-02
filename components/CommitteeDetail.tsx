"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { ChatEntryButton } from "@/components/ChatEntryButton";
import { CommitteeRoster } from "@/components/CommitteeRoster";
import { MyCommitteeCard } from "@/components/MyCommitteeCard";
import { MeetingSection } from "@/components/MeetingSection";
import { MeetingComposer } from "@/components/MeetingComposer";
import { COMMITTEES } from "@/lib/data";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchCommitteeBySlug, fetchLiveAreaNames, type CommitteeRow } from "@/lib/committeeAdmin";
import { fetchCommitteeRoster } from "@/lib/committeeRoster";
import { fetchCanOrganize, type MeetingScope } from "@/lib/meetings";
import type { Committee } from "@/lib/types";

/**
 * A committee's page — roster + chat entry. DB-driven (migration 0112) so a
 * committee an admin creates renders correctly, and its name/emoji/description
 * reflect edits. Falls back to the in-code seed for the first paint / offline
 * (and so the statically-exported page has content immediately). Client-side so
 * the same static route works for any committee without per-slug prerender of
 * live data.
 */
export function CommitteeDetail({ slug }: { slug: string }) {
  const { userId, isAdmin } = useIdentity();
  const seed = COMMITTEES.find((c) => c.slug === slug) ?? null;
  const [row, setRow] = useState<CommitteeRow | null>(
    seed ? { id: seed.slug, slug: seed.slug, name: seed.name, emoji: seed.emoji, description: seed.description, position: 0, archivedAt: null } : null,
  );
  const [resolved, setResolved] = useState(false);
  // Committee-wide meeting scheduling (migration 0116) — mirrored from the chat,
  // scoped to the committee's General channel (area = null). Needs the REAL DB
  // committee id (the seed fallback uses the slug as a placeholder id).
  const [canOrganize, setCanOrganize] = useState(false);
  const [members, setMembers] = useState<{ id: string; name: string; avatarUrl?: string | null }[]>([]);
  const [composeMeeting, setComposeMeeting] = useState(false);
  // "Who's this for?" options for the composer: the whole committee, plus the
  // roles the viewer can aim a meeting at (admin → all roles; a lead → their own).
  const [areaOptions, setAreaOptions] = useState<{ value: string | null; label: string }[]>([]);
  // Is the viewer actually ON this committee? Chat is the one thing membership
  // buys — everything else on this page (description, roles, who's on them) is
  // public by design, so a non-member browses freely and simply gets no chat
  // affordance. `null` = not resolved yet, so the button never flashes in and
  // back out. Mirrors the server rule in can_access_committee_area (0063):
  // roster-linked to this committee, or an app admin.
  const [onCommittee, setOnCommittee] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCommitteeBySlug(slug).then((c) => {
      if (!alive) return;
      if (c) setRow(c);
      setResolved(true);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    // Real uuid only (seed row uses id === slug); skip until the DB row resolves.
    const cid = row && row.id !== row.slug ? row.id : null;
    if (!cid) return;
    let cancelled = false;
    const cname = row?.name ?? "the committee";
    const scope: MeetingScope = { type: "committee", committeeId: cid, slug, area: null };
    void fetchCanOrganize(scope).then((v) => {
      if (!cancelled) setCanOrganize(v);
    });
    void Promise.all([fetchCommitteeRoster(slug), fetchLiveAreaNames(slug)]).then(([entries, areas]) => {
      if (cancelled) return;
      setMembers(
        entries
          .filter((e) => e.linkedUserId)
          .map((e) => ({ id: e.linkedUserId as string, name: e.linkedName || e.name, avatarUrl: e.linkedAvatarUrl })),
      );
      // Roles the viewer may target: all of them for an admin, else the ones
      // they lead ("<area> · Lead" in their roster roles). The server re-checks.
      const mine = entries.find((e) => e.linkedUserId && e.linkedUserId === userId);
      setOnCommittee(isAdmin || !!mine);
      const myRoles = mine?.roles ?? [];
      const allowed = isAdmin ? areas : areas.filter((a) => myRoles.includes(`${a} · Lead`));
      setAreaOptions([{ value: null, label: `Everyone on ${cname}` }, ...allowed.map((a) => ({ value: a, label: a }))]);
    });
    return () => {
      cancelled = true;
    };
  }, [row, slug, userId, isAdmin]);

  if (!row) {
    // Nothing in the seed and nothing in the DB (once resolved) → not a committee.
    if (!resolved) {
      return <div className="flex h-[40dvh] items-center justify-center text-sm text-foreground/40">Loading…</div>;
    }
    return (
      <div className="space-y-4 pt-2">
        <BackLink href="/committees" label="Committees" />
        <p className="rounded-2xl bg-card p-4 text-sm text-muted ring-1 ring-border">This committee doesn&rsquo;t exist.</p>
      </div>
    );
  }

  const committee: Committee = {
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    members: seed?.members ?? [],
  };
  // Real DB committee id (the seed fallback uses the slug as a placeholder id).
  const committeeId = row.id !== row.slug ? row.id : null;

  return (
    <div className="space-y-5 pt-2">
      <BackLink href="/committees" label="Committees" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{committee.emoji}</span>
          {committee.name}
        </h1>
        <p className="text-sm text-foreground/60">{committee.description}</p>
        {row.archivedAt && (
          <p className="mt-1 inline-block rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-medium text-muted">
            Archived — chat is read-only.{" "}
            <Link href="/admin/committees" className="font-semibold text-primary">Manage</Link>
          </p>
        )}
      </header>

      {/* The viewer's own spot on this committee, right up top — their roles at
          a glance, plus one-tap self-service to change their areas or leave.
          Self-hides for guests, non-members, and seed-only committees. */}
      <MyCommitteeCard committee={committee} committeeId={committeeId} />

      {!row.archivedAt && onCommittee === true && (
        <ChatEntryButton slug={committee.slug} name={committee.name} />
      )}

      {/* Meeting scheduling, right on the committee page (not just in the chat) —
          scoped committee-wide. The active-meeting bar shows to everyone when one
          is live; the "Schedule a meeting" button shows only to organizers. */}
      {committeeId && !row.archivedAt && (
        <>
          <MeetingSection
            surface="card"
            scope={{ type: "committee", committeeId, slug: committee.slug, area: null }}
            members={members}
          />
          {canOrganize && (
            <button
              onClick={() => setComposeMeeting(true)}
              className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-primary/10 py-3 text-sm font-semibold text-primary ring-1 ring-primary/20"
            >
              📅 Schedule a meeting
            </button>
          )}
        </>
      )}

      {/* The roster is the single membership list (migration 0057): it shows
          everyone + their roles, lets app admins add/remove/assign roles, and
          emails the committee or a single role. */}
      <CommitteeRoster committee={committee} />

      {composeMeeting && committeeId && (
        <MeetingComposer
          scope={{ type: "committee", committeeId, slug: committee.slug, area: null }}
          roomLabel={committee.name}
          areaOptions={areaOptions}
          onClose={() => setComposeMeeting(false)}
          onCreated={() => {}}
        />
      )}
    </div>
  );
}
