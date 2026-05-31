"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { toISODate } from "@/lib/festSeason";
import { formatTime } from "@/lib/format";
import type { FestHighlight } from "@/lib/types";

/**
 * The Family Fest presence on the resort home. It's the seam that makes the
 * fest feel like a season of MLR rather than a separate app:
 *
 * - run-up / off-season → a quiet banner that links to the hub (the original
 *   look), nudged to "this week" inside the final run-up;
 * - the live week → a takeover hero: the resort app leads with Family Fest
 *   ("Day n of N" + today's events), and the resort's own content recedes
 *   below it.
 *
 * Phase is computed client-side (see useFestSeason) so it's correct on both the
 * static Pages build and Vercel.
 */
export function FamilyFestSpotlight({
  name,
  tagline,
  startDate,
  endDate,
  highlights,
}: {
  name: string;
  tagline: string;
  startDate: string;
  endDate: string;
  highlights: FestHighlight[];
}) {
  const season = useFestSeason(startDate, endDate);

  // Live week — the resort app puts Family Fest front and center.
  if (season?.isLive) {
    const todays = highlights.filter((h) => h.day === toISODate());
    return (
      <Link
        href="/family-fest"
        className="block rounded-2xl bg-gradient-to-br from-campfire/20 via-sun/15 to-dusk/25 p-4 ring-1 ring-dusk/30 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-campfire/70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-campfire" />
          </span>
          <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
            {name} · happening now
          </p>
        </div>
        <p className="mt-1 text-lg font-semibold">
          Day {season.dayNumber} of {season.totalDays} at the lake 🎆
        </p>
        {todays.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {todays.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-sm">
                <span>{h.emoji}</span>
                <span className="font-medium">{h.title}</span>
                <span className="text-foreground/55">{formatTime(h.start)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-foreground/70">{tagline}</p>
        )}
        <p className="mt-2 text-xs font-medium text-campfire">Open the Family Fest hub →</p>
        <p className="mt-2 text-[11px] text-foreground/45">
          Resort info &amp; activities are below ↓
        </p>
      </Link>
    );
  }

  // Run-up / off-season — the quiet banner (original look), nudged when soon.
  return (
    <Link
      href="/family-fest"
      className="block rounded-2xl bg-gradient-to-br from-campfire/15 via-sun/10 to-dusk/20 p-4 ring-1 ring-dusk/20"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
            🎉 {name}
          </p>
          <p className="mt-1 text-sm font-semibold">{tagline}</p>
          {season != null && (
            <p className="mt-0.5 text-xs text-foreground/60">
              {season.isSoon
                ? "This week — get ready →"
                : `Starts in ${season.daysUntilStart} day${season.daysUntilStart === 1 ? "" : "s"} →`}
            </p>
          )}
        </div>
        <span className="text-3xl">🎆</span>
      </div>
    </Link>
  );
}
