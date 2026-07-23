"use client";

import Link from "next/link";
import { FestWeek } from "@/components/FestWeek";
import { useFestContent } from "@/lib/useFestContent";
import { useFestSeason } from "@/lib/useFestSeason";
import { formatDateLong } from "@/lib/format";

/**
 * Schedule — the full week agenda in one place: the anytime "things to do"
 * plus every day's events + dinner, exactly as FestWeek renders them on the
 * Overview (each row expands in place; deep drill-ins live at schedule/[id]).
 * During the live week FestWeek deliberately omits today (FestStatus on the
 * Overview shows today in full), so this page points there for today's agenda
 * instead of duplicating that block. Content comes from the shared DB via
 * useFestContent (seed fallback offline) — static-export safe, all client-side.
 */
export default function FestSchedulePage() {
  const { config, schedule, dinners, reload } = useFestContent({ realtime: true });
  const season = useFestSeason(config.startDate, config.endDate);

  return (
    <div className="space-y-4 pt-1">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Schedule</h1>
        <p className="text-sm text-foreground/60">
          {formatDateLong(config.startDate)} – {formatDateLong(config.endDate)} · tap
          anything for the details.
        </p>
      </header>

      {season?.isLive && (
        <Link
          href="/family-fest"
          className="press block rounded-2xl bg-primary/10 p-4 text-sm font-semibold text-primary ring-1 ring-primary/25"
        >
          ☀️ It&apos;s fest week! Today&apos;s full agenda is on the Overview →
        </Link>
      )}

      <FestWeek
        events={schedule}
        dinners={dinners}
        startDate={config.startDate}
        endDate={config.endDate}
        onContentSaved={reload}
      />
    </div>
  );
}
