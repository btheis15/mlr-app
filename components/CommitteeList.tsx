"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { COMMITTEES } from "@/lib/data";
import { fetchRosterCounts } from "@/lib/committeeRoster";
import { fetchCommittees, fetchAreasByCommittee, type CommitteeRow } from "@/lib/committeeAdmin";

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
  // Every committee's subcommittees in one round-trip (not one query per row).
  const [areas, setAreas] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let alive = true;
    fetchCommittees().then((rows) => {
      if (alive) setCommittees(rows.filter((c) => !c.archivedAt));
    });
    fetchRosterCounts().then((c) => alive && setCounts(c));
    fetchAreasByCommittee().then((a) => alive && setAreas(a));
    return () => {
      alive = false;
    };
  }, []);

  const seedCount = (slug: string) => COMMITTEES.find((c) => c.slug === slug)?.members.length ?? 0;

  return (
    <ul className="space-y-2">
      {committees.map((c, i) => {
        const count = counts?.[c.slug] ?? seedCount(c.slug);
        const subs = areas[c.slug] ?? [];
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
                  {subs.length > 0 && ` · ${subs.length} ${subs.length === 1 ? "subcommittee" : "subcommittees"}`}
                </p>
                {/* The subcommittees themselves, right on the index — so what
                    exists is discoverable without opening every committee. Every
                    role in the allow-list shows, including ones nobody has
                    joined yet (those are the ones that need volunteers); tapping
                    through lists who's on each. Wraps rather than truncates so a
                    committee with several roles doesn't hide the last few. */}
                {subs.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {subs.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                      >
                        {s}
                      </span>
                    ))}
                  </span>
                )}
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
