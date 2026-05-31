import Link from "next/link";
import { SCHEDULE, THINGS_TO_DO, eventDays } from "@/lib/data";
import { formatDateLong, formatTime } from "@/lib/format";

/**
 * The week at a glance. Two parts: "Anytime all week" things-to-do (no set
 * time, e.g. the scavenger hunt), then the timed day-by-day agenda — high-level
 * only (time, what, where, who's in charge). Tap any event for the details.
 */
export default function SchedulePage() {
  const days = eventDays().filter((day) => SCHEDULE.some((e) => e.day === day));

  return (
    <div className="space-y-6 pt-1">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
        <p className="text-sm text-foreground/60">
          The whole week, day by day. Tap any event for the details.
        </p>
      </header>

      {THINGS_TO_DO.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-accent">🗺️ Anytime all week</h2>
          <p className="text-xs text-foreground/50">No set time — do these whenever.</p>
          <ul className="space-y-2">
            {THINGS_TO_DO.map((a) => (
              <li key={a.id} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{a.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{a.title}</p>
                    <p className="mt-0.5 text-xs text-foreground/70">{a.blurb}</p>
                    {a.details && (
                      <p className="mt-1 text-xs leading-relaxed text-foreground/60">
                        {a.details}
                      </p>
                    )}
                    {a.location && (
                      <p className="mt-1 text-xs text-foreground/50">📍 {a.location}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {days.map((day) => {
        const events = SCHEDULE.filter((e) => e.day === day).sort((a, b) =>
          a.start.localeCompare(b.start),
        );
        return (
          <section key={day} className="space-y-3">
            <h2 className="sticky top-0 bg-background/90 py-1 text-sm font-semibold text-primary backdrop-blur">
              {formatDateLong(day)}
            </h2>
            <ul className="space-y-3">
              {events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/family-fest/schedule/${e.id}`}
                    className="flex gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
                  >
                    <div className="text-2xl">{e.emoji}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="truncate text-sm font-semibold">{e.title}</h3>
                        <span className="shrink-0 text-xs font-medium text-accent">
                          {formatTime(e.start)}
                          {e.end ? `–${formatTime(e.end)}` : ""}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/50">📍 {e.location}</p>
                      {e.lead && (
                        <p className="mt-0.5 truncate text-xs text-foreground/60">
                          In charge: {e.lead.name}
                        </p>
                      )}
                    </div>
                    <span className="self-center text-foreground/30" aria-hidden>
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
