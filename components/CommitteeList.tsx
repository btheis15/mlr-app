"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { COMMITTEES } from "@/lib/data";
import { fetchRosterCounts } from "@/lib/committeeRoster";
import { fetchCommittees, type CommitteeRow } from "@/lib/committeeAdmin";

/**
 * The Committees index list. The committees themselves come from the live DB
 * (`committees`, admin-managed via migration 0112) so a newly-created committee
 * shows up here right away and an archived ("deleted") one drops out; it falls
 * back to the in-code seed until the fetch resolves / offline. Member counts
 * come from the live DB roster (committee_roster, migrations 0056/0057) — the
 * same source the detail page reads — so the count matches who's actually on it.
 */
const seedRows: CommitteeRow[] = COMMITTEES.map((c, i) => ({
  id: c.slug,
  slug: c.slug,
  name: c.name,
  emoji: c.emoji,
  description: c.description,
  position: i,
  archivedAt: null,
}));

export function CommitteeList() {
  const [committees, setCommittees] = useState<CommitteeRow[]>(seedRows);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCommittees().then((rows) => {
      if (alive) setCommittees(rows.filter((c) => !c.archivedAt));
    });
    fetchRosterCounts().then((c) => alive && setCounts(c));
    return () => {
      alive = false;
    };
  }, []);

  const seedCount = (slug: string) => COMMITTEES.find((c) => c.slug === slug)?.members.length ?? 0;

  return (
    <ul className="space-y-2">
      {committees.map((c, i) => {
        const count = counts?.[c.slug] ?? seedCount(c.slug);
        return (
          <li
            key={c.slug}
            className="rise"
            style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
          >
            <Link
              href={`/committees/${c.slug}`}
              className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
            >
              <span className="text-2xl">{c.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="truncate text-xs text-foreground/60">{c.description}</p>
                <p className="mt-0.5 text-xs text-faint">
                  {count} {count === 1 ? "member" : "members"}
                </p>
              </div>
              <span className="text-foreground/30" aria-hidden>
                ›
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
