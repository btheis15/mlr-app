"use client";

import Link from "next/link";
import { useCanEditFest } from "@/lib/hooks";
import { FestStatus } from "@/components/FestStatus";
import { FestRsvp } from "@/components/FestRsvp";
import { FestWeek } from "@/components/FestWeek";
import { FestDuesCallout } from "@/components/FestDuesCallout";
import { FestCommitteesLink } from "@/components/FestCommitteesLink";
import { FestCover } from "@/components/FestCover";
import { FestSetupChecklist } from "@/components/FestSetupChecklist";
import { useFestContent } from "@/lib/useFestContent";
import { useFestSeason } from "@/lib/useFestSeason";
import { formatDateLong } from "@/lib/format";

/** Is this ISO day inside the fest week? (See the set-up checklist below.) */
function inWindow(day: string, config: { startDate: string; endDate: string }): boolean {
  return day >= config.startDate && day <= config.endDate;
}

/**
 * Family Fest — one integrated view. The focal point up top is what's happening
 * *today* (events + dinner in full, via FestStatus); below is the look-ahead
 * week as an expandable accordion (FestWeek), each row expanding in place.
 * This is also why there's no "Schedule" pill in FamilyFestNav — it would
 * just show this same accordion a second time.
 *
 * The schedule, dinners, dates, name, THEME, cover photo and palette all come
 * from the shared DB (migrations 0053 + 0219) via useFestContent, so admin/
 * committee edits in the Planner show up here and on iOS alike; they fall back
 * to the in-code seed when there's no backend. Fest editors get a quiet "Edit"
 * link to the Planner, plus a set-up checklist while a new year is still taking
 * shape.
 */
export default function FamilyFestPage() {
  const { config, schedule, dinners, dues, payees, reload } = useFestContent({ realtime: true });
  const season = useFestSeason(config.startDate, config.endDate);
  // Cached edit-permission — the "Edit Family Fest" link seeds instantly instead
  // of popping in a frame or two late each visit (see useCanEditFest).
  const canEdit = useCanEditFest();

  return (
    <div className="space-y-4 pt-1">
      <header className="space-y-2 text-center">
        <FestCover alt={`${config.name} cover`} coverUrl={config.coverUrl} />
        <h1 className="text-xl font-bold tracking-tight">{config.name}</h1>
        {/* The theme line is this YEAR's (fest_config.theme, 0219) — it used to
            be a hardcoded FAMILY_FEST.theme, so a new year advertised the last
            one's theme until someone shipped a build. A year that hasn't picked
            a theme yet shows just its dates rather than empty heraldry. */}
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
          {config.theme ? `⚜ ${config.theme} ⚜ · ` : ""}
          {formatDateLong(config.startDate)} – {formatDateLong(config.endDate)}
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

      {/* Editors only: what's still to set up for this year (hides itself once
          the year is planned, and never shows on a fest that's already over). */}
      {canEdit && (
        <FestSetupChecklist
          config={config}
          // Counted WITHIN this year's window, not `schedule.length`. An empty
          // current year falls back to the in-code 2026 seed (so the hub is
          // never blank), whose days sit outside a new year's dates and render
          // as nothing — a raw length would tick "build the daily plan" for a
          // week that shows no plan at all.
          scheduleCount={schedule.filter((e) => inWindow(e.day, config)).length}
          dinnerCount={dinners.filter((d) => inWindow(d.day, config)).length}
          duesSet={dues.some((d) => d.amount != null)}
          payeeCount={payees.length}
          concluded={Boolean(season?.isConcluded)}
        />
      )}

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

      {/* Attendance — are you coming? (Going / Maybe / Can't make + day picker.)
          Scoped to THIS year's synthesized event, so a new fest gets a fresh
          RSVP instead of inheriting last year's answers. */}
      <FestRsvp year={config.year} />

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
