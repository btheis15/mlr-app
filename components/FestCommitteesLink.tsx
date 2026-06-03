"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * During fest week, surface the **Family Fest committee** right under the daily
 * summary — tap to see who's running things and reach them. The other resort
 * committees aren't relevant during the fest; they live on the regular
 * Committees tab (off the Home page). Hidden outside the week.
 */
export function FestCommitteesLink() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season?.isLive) return null;

  return (
    <Link
      href="/committees/family-fest"
      className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border"
    >
      <span className="text-2xl">🎉</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Contact the Family Fest committee</p>
        <p className="text-xs text-foreground/60">
          See who&rsquo;s running things — tap for names &amp; contacts.
        </p>
      </div>
      <span className="shrink-0 text-foreground/30" aria-hidden>
        ›
      </span>
    </Link>
  );
}
