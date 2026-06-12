import Link from "next/link";
import { FestStatus } from "@/components/FestStatus";
import { FestRsvp } from "@/components/FestRsvp";
import { FestWeek } from "@/components/FestWeek";
import { FestDuesShirts } from "@/components/FestDuesShirts";
import { FestCommitteesLink } from "@/components/FestCommitteesLink";
import { FestCover } from "@/components/FestCover";
import { FAMILY_FEST, RESORT, SCHEDULE, DINNERS, THINGS_TO_DO } from "@/lib/data";
import { formatDateLong } from "@/lib/format";

/**
 * Family Fest — one integrated view. The focal point up top is what's happening
 * *today* (events + dinner in full, via FestStatus); below is the look-ahead
 * week as an expandable accordion (FestWeek), with dinners clicking through
 * inside each day. No sub-nav, no separate Schedule/Dinners/Crew pages.
 */
export default function FamilyFestPage() {
  return (
    <div className="space-y-6 pt-1">
      <header className="space-y-3 text-center">
        <FestCover alt="Ye Olde Family Feste — Family Fest 2026" />
        <h1 className="text-2xl font-bold tracking-tight">{FAMILY_FEST.name}</h1>
        <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-primary">
          ⚜ {FAMILY_FEST.theme} ⚜
        </p>
        <p className="text-xs text-foreground/50">
          {formatDateLong(FAMILY_FEST.startDate)} – {formatDateLong(FAMILY_FEST.endDate)}
        </p>
        {/* The Family Fest heritage stamp — the fest began in 1987 (what the logo
            reads). The resort itself dates to 1959; that line lives on Home. */}
        <p className="font-display text-[11px] uppercase tracking-[0.18em] text-primary/70">
          ⚜ A family tradition since {RESORT.est} ⚜
        </p>
      </header>

      {/* Countdown (and the day-of summary once the week is live). */}
      <FestStatus
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
        events={SCHEDULE}
        dinners={DINNERS}
        volunteerContact={FAMILY_FEST.organizer}
      />

      {/* Attendance — are you coming? (Going / Maybe / Can't make + day picker.) */}
      <FestRsvp />

      {/* Pay Dues + Order T-Shirts, side by side (run-up only). */}
      <FestDuesShirts />

      {/* Committees stay reachable from the hub. */}
      <FestCommitteesLink />

      <FestWeek
        events={SCHEDULE}
        dinners={DINNERS}
        things={THINGS_TO_DO}
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
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
