"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { COMMITTEES } from "@/lib/data";
import { fetchRosterCounts } from "@/lib/committeeRoster";

/**
 * The Committees index list. Member counts come from the live DB roster
 * (committee_roster, migrations 0056/0057) — the same source the detail page
 * reads — so the count matches who's actually on the committee. Until the fetch
 * resolves (and offline / no backend), it falls back to the in-code seed count,
 * so the list always renders.
 */
export function CommitteeList() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchRosterCounts().then((c) => alive && setCounts(c));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ul className="space-y-2">
      {COMMITTEES.map((c, i) => {
        const count = counts?.[c.slug] ?? c.members.length;
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
                <p className="mt-0.5 text-[11px] text-foreground/40">
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
