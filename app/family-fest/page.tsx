import { FestStatus } from "@/components/FestStatus";
import { FAMILY_FEST } from "@/lib/data";
import { formatDateLong, formatTime } from "@/lib/format";

/**
 * The embedded Family Fest hub — the "app within the app". It mirrors the
 * highlights of the standalone family-fest app and links into it for the full
 * experience (schedule, crew/RSVP, photos).
 */
export default function FamilyFestPage() {
  return (
    <div className="space-y-6 pt-6">
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
          <span className="text-sm font-semibold uppercase tracking-[0.15em] text-primary">
            ⚜ {FAMILY_FEST.theme} ⚜
          </span>
          <span className="text-[11px] text-foreground/50">{FAMILY_FEST.themeNote}</span>
        </div>
        <p className="text-foreground/60">{FAMILY_FEST.tagline}</p>
        <p className="text-sm text-foreground/50">
          {formatDateLong(FAMILY_FEST.startDate)} – {formatDateLong(FAMILY_FEST.endDate)}
        </p>
      </header>

      <FestStatus
        startDate={FAMILY_FEST.startDate}
        endDate={FAMILY_FEST.endDate}
        items={FAMILY_FEST.highlights}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-accent">Highlights</h2>
        <ul className="space-y-2">
          {FAMILY_FEST.highlights.map((h) => (
            <li
              key={h.id}
              className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border"
            >
              <span className="text-xl">{h.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{h.title}</p>
                <p className="text-xs text-foreground/50">
                  {formatDateLong(h.day)} · {formatTime(h.start)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <a
        href={FAMILY_FEST.appUrl}
        className="block rounded-2xl bg-primary p-4 text-center text-sm font-semibold text-white"
      >
        Enter the full Family Fest app →
        <span className="mt-0.5 block text-xs font-normal text-white/80">
          Schedule, crew &amp; RSVP, potluck, and the shared photo album
        </span>
      </a>
      <p className="text-center text-xs text-foreground/40">
        Opens the Family Fest app — tap “← Resort home” there to come back.
      </p>
    </div>
  );
}
