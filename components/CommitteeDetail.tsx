"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { ChatEntryButton } from "@/components/ChatEntryButton";
import { CommitteeRoster } from "@/components/CommitteeRoster";
import { MeetingSection } from "@/components/MeetingSection";
import { MeetingComposer } from "@/components/MeetingComposer";
import { COMMITTEES } from "@/lib/data";
import { fetchCommitteeBySlug, type CommitteeRow } from "@/lib/committeeAdmin";
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
    const scope: MeetingScope = { type: "committee", committeeId: cid, slug, area: null };
    void fetchCanOrganize(scope).then((v) => {
      if (!cancelled) setCanOrganize(v);
    });
    void fetchCommitteeRoster(slug).then((entries) => {
      if (cancelled) return;
      setMembers(
        entries
          .filter((e) => e.linkedUserId)
          .map((e) => ({ id: e.linkedUserId as string, name: e.linkedName || e.name, avatarUrl: e.linkedAvatarUrl })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [row, slug]);

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

      {!row.archivedAt && <ChatEntryButton slug={committee.slug} name={committee.name} />}

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
          onClose={() => setComposeMeeting(false)}
          onCreated={() => {}}
        />
      )}
    </div>
  );
}
