"use client";

import { Countdown } from "@/components/Countdown";
import { useFestSeason } from "@/lib/useFestSeason";
import { toISODate } from "@/lib/festSeason";
import { formatTime } from "@/lib/format";
import type { FestHighlight } from "@/lib/types";

/**
 * The status block on the Family Fest hub: a countdown in the run-up, and a
 * live "Day n of N + Today at the Fest" panel during the event week — so the
 * hub reflects where we are in the fest season, not just a clock to a fixed
 * date. (Mirrors the same component in the family-fest app.)
 */
export function FestStatus({
  startDate,
  endDate,
  items,
}: {
  startDate: string;
  endDate: string;
  items: FestHighlight[];
}) {
  const season = useFestSeason(startDate, endDate);

  if (!season?.isLive) {
    return <Countdown target={startDate} />;
  }

  const todays = items.filter((i) => i.day === toISODate());

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-primary/10 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Happening now
        </p>
        <p className="mt-1 text-lg font-bold text-primary">
          Day {season.dayNumber} of {season.totalDays}
        </p>
        <p className="text-xs text-foreground/60">
          We&rsquo;re at the lake — welcome to Family Fest 🎆
        </p>
      </div>
      {todays.length > 0 && (
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <h2 className="text-sm font-semibold text-accent">Today at the Fest</h2>
          <ul className="mt-2 space-y-2">
            {todays.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span className="text-xl">{i.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.title}</p>
                  <p className="text-xs text-foreground/50">{formatTime(i.start)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
