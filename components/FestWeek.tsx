"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { formatDateLong, formatTime } from "@/lib/format";
import type { ScheduleEvent, Dinner, FestActivity } from "@/lib/types";

/**
 * The look-ahead: anytime "things to do" + the week as an expandable accordion.
 * Each day expands to its events and that day's dinner — and the dinner is a
 * click-through right inside that day. During the live week, today is omitted
 * here (it's shown in full up top by FestStatus). Tapping any event or dinner
 * opens its detail page.
 */
export function FestWeek({
  events,
  dinners,
  things,
  startDate,
  endDate,
}: {
  events: ScheduleEvent[];
  dinners: Dinner[];
  things: FestActivity[];
  startDate: string;
  endDate: string;
}) {
  const season = useFestSeason(startDate, endDate);
  const { today } = useDemoDate();
  const [open, setOpen] = useState<string | null>(null);

  const allDays = Array.from(
    new Set([...events.map((e) => e.day), ...dinners.map((d) => d.day)]),
  ).sort();
  // While live, today is shown in full by FestStatus above — drop it here.
  const days = season?.isLive ? allDays.filter((d) => d !== today) : allDays;

  useEffect(() => {
    // Open today if it's in the (non-live) list, else the first day.
    setOpen(
      today && allDays.includes(today) && !season?.isLive
        ? today
        : (days[0] ?? null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season?.isLive, today]);

  return (
    <section className="space-y-3">
      {things.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-accent">🗺️ Anytime all week</h2>
          {things.map((a) => (
            <div key={a.id} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <p className="text-sm font-semibold">
                {a.emoji} {a.title}
              </p>
              <p className="mt-0.5 text-xs text-foreground/70">{a.blurb}</p>
              {a.details && (
                <p className="mt-1 text-xs leading-relaxed text-foreground/60">{a.details}</p>
              )}
              {a.location && <p className="mt-1 text-xs text-foreground/50">📍 {a.location}</p>}
            </div>
          ))}
        </div>
      )}

      {days.length > 0 && (
        <h2 className="text-sm font-semibold text-primary">
          {season?.isLive ? "The rest of the week" : "The whole week"}
        </h2>
      )}
      <ul className="space-y-2">
        {days.map((day) => {
          const dayEvents = events
            .filter((e) => e.day === day)
            .sort((a, b) => a.start.localeCompare(b.start));
          const dinner = dinners.find((d) => d.day === day);
          const expanded = open === day;
          return (
            <li key={day} className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
              <button
                onClick={() => setOpen((o) => (o === day ? null : day))}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2 p-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{formatDateLong(day)}</p>
                  <p className="truncate text-xs text-foreground/50">
                    {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
                    {dinner ? ` · 🍽️ ${dinner.title}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-foreground/40 transition-transform ${expanded ? "rotate-90" : ""}`}
                  aria-hidden
                >
                  ›
                </span>
              </button>
              {expanded && (
                <div className="space-y-2 px-4 pb-4">
                  {dayEvents.map((e) => (
                    <Link
                      key={e.id}
                      href={`/family-fest/schedule/${e.id}`}
                      className="flex items-center gap-3 rounded-xl bg-background/60 p-2 ring-1 ring-border/60"
                    >
                      <span className="text-lg">{e.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.title}</p>
                        <p className="text-xs text-foreground/50">
                          {formatTime(e.start)} · {e.location}
                        </p>
                      </div>
                      <span className="text-foreground/30" aria-hidden>
                        ›
                      </span>
                    </Link>
                  ))}
                  {dinner && (
                    <Link
                      href={`/family-fest/dinners/${dinner.id}`}
                      className="flex items-center gap-3 rounded-xl bg-primary/5 p-2 ring-1 ring-primary/20"
                    >
                      <span className="text-lg">{dinner.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">Dinner · {dinner.title}</p>
                        <p className="text-xs text-foreground/50">
                          {dinner.time} · {dinner.location}
                        </p>
                      </div>
                      <span className="text-foreground/30" aria-hidden>
                        ›
                      </span>
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
