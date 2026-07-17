"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { ChatEntryButton } from "@/components/ChatEntryButton";
import { CommitteeRoster } from "@/components/CommitteeRoster";
import { COMMITTEES } from "@/lib/data";
import { fetchCommitteeBySlug, type CommitteeRow } from "@/lib/committeeAdmin";
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

      {/* The roster is the single membership list (migration 0057): it shows
          everyone + their roles, lets app admins add/remove/assign roles, and
          emails the committee or a single role. */}
      <CommitteeRoster committee={committee} />
    </div>
  );
}
