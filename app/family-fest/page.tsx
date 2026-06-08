import Link from "next/link";
import { FestStatus } from "@/components/FestStatus";
import { FestWeek } from "@/components/FestWeek";
import { FestDuesCallout } from "@/components/FestDuesCallout";
import { TshirtCallout } from "@/components/TshirtCallout";
import { FestCommitteesLink } from "@/components/FestCommitteesLink";
import { FAMILY_FEST, SCHEDULE, DINNERS, THINGS_TO_DO } from "@/lib/data";
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
        <div className="overflow-hidden rounded-2xl ring-1 ring-border shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/family-fest-2026.jpg"
            alt="Ye Olde Family Feste — Family Fest 2026"
            className="block w-full"
          />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{FAMILY_FEST.name}</h1>
        <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-primary">
          ⚜ {FAMILY_FEST.theme} ⚜
        </p>
        <p className="text-xs text-foreground/50">
          {formatDateLong(FAMILY_FEST.startDate)} – {formatDateLong(FAMILY_FEST.endDate)}
        </p>
      </header>

      {/* Pay-your-dues CTA, prominent during the run-up. */}
      <FestDuesCallout />

      {/* Order T-Shirts — right under dues (placeholder until designs land). */}
      <TshirtCallout />

      <FestStatus
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
        events={SCHEDULE}
        dinners={DINNERS}
        volunteerContact={FAMILY_FEST.organizer}
      />

      {/* During the week, committees stay reachable under the daily summary. */}
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
