"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { toISODate } from "@/lib/festSeason";
import { formatTime } from "@/lib/format";
import type { FestHighlight } from "@/lib/types";

/**
 * The Family Fest presence on the resort home. It's the seam that makes the
 * fest feel like a season of MLR rather than a separate app, shifting with the
 * shared season model (lib/festSeason.ts):
 *
 * - off-season → a quiet banner that links to the hub (the original look);
 * - planning (from ~60 days out) → a partial takeover: rally volunteers + show
 *   what's being planned so far;
 * - the live week → a full takeover hero ("Day n of N" + today's events), and
 *   the resort's own content recedes below it;
 * - wrap (2 weeks after) → the full takeover lingers, nudging people to post
 *   the photos they didn't get to during the week.
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
        <LiveDotLabel>{name} · happening now</LiveDotLabel>
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

  // Wrap — the takeover lingers for two weeks so photos keep coming in.
  if (season?.isWrap) {
    return (
      <Link
        href="/family-fest"
        className="block rounded-2xl bg-gradient-to-br from-campfire/20 via-sun/15 to-dusk/25 p-4 ring-1 ring-dusk/30 shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
          🎆 {name} · that&rsquo;s a wrap
        </p>
        <p className="mt-1 text-lg font-semibold">Thanks for a great week at the lake</p>
        <p className="mt-1 text-sm text-foreground/70">
          Add the photos you didn&rsquo;t get to share yet.
        </p>
        <p className="mt-2 text-xs font-medium text-campfire">Add your photos →</p>
        {season.wrapDaysLeft > 0 && (
          <p className="mt-2 text-[11px] text-foreground/45">
            Album stays open for {season.wrapDaysLeft} more day
            {season.wrapDaysLeft === 1 ? "" : "s"}.
          </p>
        )}
      </Link>
    );
  }

  // Planning — partial takeover: gather volunteers and preview what's planned.
  if (season?.isPlanning) {
    const preview = highlights.slice(0, 3);
    return (
      <Link
        href="/family-fest"
        className="block rounded-2xl bg-gradient-to-br from-campfire/15 via-sun/10 to-dusk/20 p-4 ring-1 ring-dusk/25"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
          🎉 {name} · planning underway
        </p>
        <p className="mt-1 text-base font-semibold">
          {season.isSoon
            ? "Almost here — final plans coming together"
            : `${season.daysUntilStart} days out — here's what's taking shape`}
        </p>
        {preview.length > 0 && (
          <ul className="mt-2 space-y-1">
            {preview.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-sm">
                <span>{h.emoji}</span>
                <span className="font-medium">{h.title}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs font-medium text-campfire">
          🙋 Volunteers welcome — see the plans &amp; pitch in →
        </p>
      </Link>
    );
  }

  // Off-season — the quiet banner (original look).
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
              {season.daysUntilStart > 0
                ? `Starts in ${season.daysUntilStart} days →`
                : "Returns next summer →"}
            </p>
          )}
        </div>
        <span className="text-3xl">🎆</span>
      </div>
    </Link>
  );
}

function LiveDotLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-campfire/70" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-campfire" />
      </span>
      <p className="text-xs font-semibold uppercase tracking-wide text-campfire">
        {children}
      </p>
    </div>
  );
}
