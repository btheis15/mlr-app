import Link from "next/link";
import { FestStatus } from "@/components/FestStatus";
import { FAMILY_FEST, SCHEDULE } from "@/lib/data";
import { formatDateLong, formatTime } from "@/lib/format";

/**
 * Family Fest overview — the section's landing page, inside the resort app.
 * Headline only: the poster/identity, where we are in the season (FestStatus),
 * and what's next. Everything else is one tap away on the sub-nav (Schedule,
 * Dinners, Crew, Photos, Pay) — no "open the full app" hop anymore.
 */
export default function FamilyFestPage() {
  const nextEvent = SCHEDULE[0];

  return (
    <div className="space-y-6 pt-1">
      <header className="space-y-3 text-center">
        <div className="overflow-hidden rounded-2xl ring-1 ring-border shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/family-fest-2026.jpg"
            alt="Family Fest 2026 — Renaissance / Fantasy"
            className="block w-full"
          />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{FAMILY_FEST.name}</h1>
        <div className="mx-auto inline-flex flex-col items-center gap-0.5 rounded-2xl border border-border bg-card px-4 py-2">
          <span className="font-display text-sm font-semibold uppercase tracking-[0.15em] text-primary">
            ⚜ {FAMILY_FEST.theme} ⚜
          </span>
          <span className="text-[11px] text-foreground/50">{FAMILY_FEST.themeNote}</span>
        </div>
        <p className="text-sm text-foreground/70">{FAMILY_FEST.tagline}</p>
        <p className="text-xs text-foreground/50">
          {formatDateLong(FAMILY_FEST.startDate)} – {formatDateLong(FAMILY_FEST.endDate)}
        </p>
      </header>

      <FestStatus
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
        items={SCHEDULE}
        volunteerContact={FAMILY_FEST.organizer}
      />

      <Link
        href="/family-fest/schedule"
        className="block rounded-2xl bg-card p-4 ring-1 ring-border"
      >
        <h2 className="text-sm font-semibold text-primary">Next up</h2>
        <div className="mt-1 flex items-center gap-3">
          <span className="text-2xl">{nextEvent.emoji}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{nextEvent.title}</p>
            <p className="text-xs text-foreground/60">
              {formatDateLong(nextEvent.day)} · {formatTime(nextEvent.start)} ·{" "}
              {nextEvent.location}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs font-medium text-primary">See the full week →</p>
      </Link>
    </div>
  );
}
