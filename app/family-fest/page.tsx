"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FestStatus } from "@/components/FestStatus";
import { FestRsvp } from "@/components/FestRsvp";
import { FestWeek } from "@/components/FestWeek";
import { FestDuesCallout } from "@/components/FestDuesCallout";
import { FestCommitteesLink } from "@/components/FestCommitteesLink";
import { FestCover } from "@/components/FestCover";
import { FAMILY_FEST } from "@/lib/data";
import { useFestContent } from "@/lib/useFestContent";
import { canEditFest } from "@/lib/festContent";
import { useIdentity } from "@/components/IdentityProvider";
import { formatDateLong } from "@/lib/format";

/**
 * Family Fest — one integrated view. The focal point up top is what's happening
 * *today* (events + dinner in full, via FestStatus); below is the look-ahead
 * week as an expandable accordion (FestWeek), with dinners clicking through
 * inside each day. No sub-nav, no separate Schedule/Dinners/Crew pages.
 *
 * The schedule, dinners, dates and name come from the shared DB (migration 0053)
 * via useFestContent, so admin/committee edits in the Planner show up here and on
 * iOS alike; they fall back to the in-code seed when there's no backend. Fest
 * editors get a quiet "Edit" link to the Planner.
 */
export default function FamilyFestPage() {
  const { config, schedule, dinners, activities, reload } = useFestContent({ realtime: true });
  const { user } = useIdentity();
  const [canEdit, setCanEdit] = useState(false);

  // Only signed-in members can possibly edit; re-check when sign-in flips.
  useEffect(() => {
    let active = true;
    if (!user) {
      setCanEdit(false);
      return;
    }
    canEditFest().then((ok) => active && setCanEdit(ok));
    return () => {
      active = false;
    };
  }, [user]);

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

      {/* Countdown (and the day-of summary once the week is live). */}
      <FestStatus
        startDate={config.startDate}
        endDate={config.endDate}
        events={schedule}
        dinners={dinners}
      />

      {/* Attendance — are you coming? (Going / Maybe / Can't make + day picker.) */}
      <FestRsvp />

      {/* Pay Dues (run-up only). */}
      <FestDuesCallout />

      {/* Committees stay reachable from the hub. */}
      <FestCommitteesLink />

      <FestWeek
        events={schedule}
        dinners={dinners}
        things={activities}
        startDate={config.startDate}
        endDate={config.endDate}
        onDinnerSaved={reload}
      />

      <Link
        href="/family-fest/pay"
        className="press block rounded-2xl bg-card p-4 text-center text-sm font-semibold text-primary ring-1 ring-border"
      >
        💸 Pay the organizers →
      </Link>
    </div>
  );
}
