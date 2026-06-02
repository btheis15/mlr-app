"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * During the fest week, surface Committees right under the daily summary on the
 * Family Fest page — so people can message a group or sign up to help while
 * everyone's together and plans are being discussed. Hidden outside the week
 * (the home keeps a Committees card the rest of the time).
 */
export function FestCommitteesLink() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season?.isLive) return null;

  return (
    <Link
      href="/committees"
      className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border"
    >
      <span className="text-2xl">🤝</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Committees</p>
        <p className="text-xs text-foreground/60">
          Message a group or sign up to help while we&rsquo;re all here.
        </p>
      </div>
      <span className="shrink-0 text-foreground/30" aria-hidden>
        ›
      </span>
    </Link>
  );
}
