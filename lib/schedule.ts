// Selectors over the Family Fest schedule. Keep schedule queries here so the
// Fest components agree on how the week is sliced (the same spirit as
// lib/format.ts for display). Pure functions over passed-in arrays — no data
// import — so they're trivial to test and reuse as the section grows.

import type { ScheduleEvent, Dinner } from "@/lib/types";

/** A day's events (ISO "YYYY-MM-DD"), sorted by start time. A null day (no
 *  date resolved yet) matches nothing. */
export function eventsForDay(events: ScheduleEvent[], day: string | null): ScheduleEvent[] {
  return events
    .filter((e) => e.day === day)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** The dinner scheduled for a day, if any. */
export function dinnerForDay(dinners: Dinner[], day: string | null): Dinner | undefined {
  return dinners.find((d) => d.day === day);
}
