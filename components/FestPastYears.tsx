"use client";

import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { FestWeek } from "@/components/FestWeek";
import { SkeletonList } from "@/components/Skeleton";
import { festAlbumHref } from "@/lib/data";
import { formatDateLong } from "@/lib/format";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useFestYearContent, useFestYears } from "@/lib/useFestContent";
import { pastFestYears, type FestYear } from "@/lib/festYears";

/**
 * **Past Years** — the Family Fest archive.
 *
 * Family Fest is one week a year that the family spends a year planning, and
 * until now the app kept exactly one of them: when a fest ended, its schedule,
 * dinners, menus and crew assignments just sat on the hub going stale, and the
 * only way to start a new year would have been to overwrite them. This screen
 * is where a finished fest goes instead — the whole week preserved, readable,
 * and out of the way of next year's planning.
 *
 * One route, two views, switched by a `?year=` param read client-side — the
 * `/drop?box=` / `/house?house=` idiom, so there's no dynamic segment to
 * prerender and `/family-fest/past?year=2026` is a shareable link.
 *
 * A year lands here on its own, purely from its dates (see lib/festYears.ts) —
 * nothing has to be archived by hand, and nothing can be forgotten.
 */
export function FestPastYears({ year }: { year: number | null }) {
  const { years, loading } = useFestYears();
  const { today } = useDemoDate();
  // `today` is null until mounted (SSR-safe), and pastFestYears is date-based —
  // so hold the list until we have a real day rather than computing it against
  // a server-side "now" the client might disagree with.
  const past = today ? pastFestYears(years, today) : [];

  if (year != null) {
    return <PastYearDetail year={year} years={years} loading={loading || !today} past={past} />;
  }

  return (
    <div className="space-y-4 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Past Years</h1>
        <p className="text-sm text-muted">
          Every Family Fest we&rsquo;ve had, kept whole — the week, the dinners, and who ran what.
        </p>
      </header>

      {loading || !today ? (
        <SkeletonList count={2} />
      ) : past.length === 0 ? (
        <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted ring-1 ring-border">
          No past Family Fests yet. Once a week wraps up, it lands here — schedule, dinners and all.
        </p>
      ) : (
        <ul className="space-y-3">
          {past.map((y) => (
            <li key={y.year}>
              <Link
                href={`/family-fest/past?year=${y.year}`}
                className="press flex items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
              >
                <span aria-hidden className="text-2xl">
                  🎪
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{y.name}</p>
                  <p className="text-xs text-muted">
                    {formatDateLong(y.startDate)} – {formatDateLong(y.endDate)}
                  </p>
                  {y.tagline && <p className="mt-0.5 truncate text-xs text-faint">{y.tagline}</p>}
                </div>
                <span aria-hidden className="shrink-0 text-foreground/40">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One archived year, read-only: the closing note, its photo album, and the
 *  whole week exactly as the hub rendered it — minus anything actionable. */
function PastYearDetail({
  year,
  years,
  loading,
  past,
}: {
  year: number;
  years: FestYear[];
  loading: boolean;
  past: FestYear[];
}) {
  const { content, loading: contentLoading } = useFestYearContent(year);
  const meta = years.find((y) => y.year === year) ?? null;
  // Only a year that's genuinely OVER belongs here. A `?year=` pointing at the
  // fest currently being planned would otherwise render the live week as though
  // it were history — so send it back to the hub, which owns that year.
  const isPast = past.some((y) => y.year === year);

  return (
    <div className="space-y-4 pt-1">
      <BackLink href="/family-fest/past" label="Past Years" />

      {loading ? (
        <SkeletonList count={2} />
      ) : !meta ? (
        <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted ring-1 ring-border">
          We don&rsquo;t have a Family Fest on record for {year}.
        </p>
      ) : !isPast ? (
        <div className="rounded-2xl bg-card p-4 text-center text-sm ring-1 ring-border">
          <p className="text-muted">{meta.name} hasn&rsquo;t happened yet.</p>
          <Link href="/family-fest" className="press mt-2 inline-block font-semibold text-primary">
            See what&rsquo;s planned →
          </Link>
        </div>
      ) : (
        <>
          <header className="space-y-1 text-center">
            <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
              ⚜ In the archives ⚜
            </p>
            <h1 className="text-xl font-bold tracking-tight">{meta.name}</h1>
            <p className="text-sm text-muted">
              {formatDateLong(meta.startDate)} – {formatDateLong(meta.endDate)}
            </p>
            {meta.tagline && <p className="text-xs text-faint">{meta.tagline}</p>}
          </header>

          <div className="rounded-2xl bg-primary/10 p-4 text-center">
            <p className="text-sm font-bold text-primary">Thank you for a great Family Fest 🎆</p>
            <p className="mt-1 text-sm text-muted">See you next year!</p>
            <Link
              href={festAlbumHref(year)}
              className="press mt-2 inline-block text-sm font-semibold text-primary"
            >
              📸 Photos &amp; videos from {year} →
            </Link>
          </div>

          {contentLoading && !content ? (
            <SkeletonList count={3} />
          ) : !content || (content.schedule.length === 0 && content.dinners.length === 0) ? (
            <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted ring-1 ring-border">
              No schedule was saved for this one.
            </p>
          ) : (
            <FestWeek
              events={content.schedule}
              dinners={content.dinners}
              startDate={meta.startDate}
              endDate={meta.endDate}
              readOnly
            />
          )}
        </>
      )}
    </div>
  );
}
