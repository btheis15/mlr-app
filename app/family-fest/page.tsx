"use client";

import Link from "next/link";
import { useCanEditFest } from "@/lib/hooks";
import { FestStatus } from "@/components/FestStatus";
import { FestRsvp } from "@/components/FestRsvp";
import { FestWeek } from "@/components/FestWeek";
import { FestDuesCallout } from "@/components/FestDuesCallout";
import { FestCommitteesLink } from "@/components/FestCommitteesLink";
import { FestCover } from "@/components/FestCover";
import { FAMILY_FEST } from "@/lib/data";
import { useFestContent } from "@/lib/useFestContent";
import { useFestSeason } from "@/lib/useFestSeason";
import { formatDateLong } from "@/lib/format";

/**
 * Family Fest — one integrated view. The focal point up top is what's happening
 * *today* (events + dinner in full, via FestStatus); below is the look-ahead
 * week as an expandable accordion (FestWeek), each row expanding in place.
 * This is also why there's no "Schedule" pill in FamilyFestNav — it would
 * just show this same accordion a second time.
 *
 * The schedule, dinners, dates and name come from the shared DB (migration 0053)
 * via useFestContent, so admin/committee edits in the Planner show up here and on
 * iOS alike; they fall back to the in-code seed when there's no backend. Fest
 * editors get a quiet "Edit" link to the Planner.
 */
export default function FamilyFestPage() {
  const { config, schedule, dinners, reload } = useFestContent({ realtime: true });
  const season = useFestSeason(config.startDate, config.endDate);
  // Cached edit-permission — the "Edit Family Fest" link seeds instantly instead
  // of popping in a frame or two late each visit (see useCanEditFest).
  const canEdit = useCanEditFest();

  return (
    <div className="space-y-4 pt-1">
      <header className="space-y-2 text-center">
        <FestCover alt="Ye Olde Family Feste — Family Fest 2026" />
        <h1 className="text-xl font-bold tracking-tight">{config.name}</h1>
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
          ⚜ {FAMILY_FEST.theme} ⚜ · {formatDateLong(config.startDate)} – {formatDateLong(config.endDate)}
        </p>
        {canEdit && (
          <Link
            href="/family-fest/master"
            className="press inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
          >
            ✏️ Edit Family Fest
          </Link>
        )}
      </header>

      {/* Countdown (and the day-of summary once the week is live; the thank-you
          + a way into Past Years once it's over). */}
      <FestStatus
        name={config.name}
        tagline={config.tagline}
        startDate={config.startDate}
        endDate={config.endDate}
        events={schedule}
        dinners={dinners}
        onContentSaved={reload}
      />

      {/* Attendance — are you coming? (Going / Maybe / Can't make + day picker.) */}
      <FestRsvp />

      {/* Pay Dues (run-up only). */}
      <FestDuesCallout />

      {/* Committees stay reachable from the hub. */}
      <FestCommitteesLink />

      {/* Once the fest is over, the week itself moves to Past Years — leaving a
          finished schedule sitting on the hub is what made the section read as
          though it hadn't noticed the fest had ended. FestStatus's concluded
          card links straight to the archive. It comes back the moment a new
          year exists, since `config` then describes THAT fest. */}
      {!season?.isConcluded && (
        <FestWeek
          events={schedule}
          dinners={dinners}
          startDate={config.startDate}
          endDate={config.endDate}
          onContentSaved={reload}
        />
      )}
    </div>
  );
}
