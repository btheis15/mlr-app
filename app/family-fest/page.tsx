import { Countdown } from "@/components/Countdown";
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
      <header className="space-y-2">
        <div className="text-4xl">🎉</div>
        <h1 className="text-2xl font-bold tracking-tight">{FAMILY_FEST.name}</h1>
        <p className="text-foreground/60">{FAMILY_FEST.tagline}</p>
        <p className="text-sm text-foreground/50">
          {formatDateLong(FAMILY_FEST.startDate)} – {formatDateLong(FAMILY_FEST.endDate)}
        </p>
      </header>

      <Countdown target={FAMILY_FEST.startDate} />

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
        target="_blank"
        rel="noreferrer"
        className="block rounded-2xl bg-primary p-4 text-center text-sm font-semibold text-white"
      >
        Open the full Family Fest app →
        <span className="mt-0.5 block text-xs font-normal text-white/80">
          Schedule, crew &amp; RSVP, potluck, and the shared photo album
        </span>
      </a>
    </div>
  );
}
