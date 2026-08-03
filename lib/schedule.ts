// Selectors over the Family Fest schedule. Keep schedule queries here so the
// Fest components agree on how the week is sliced (the same spirit as
// lib/format.ts for display). Pure functions over passed-in arrays — no data
// import — so they're trivial to test and reuse as the section grows.

import type { ScheduleEvent, Dinner } from "@/lib/types";
import { timeToMinutes } from "@/lib/format";

/** A day's events (ISO "YYYY-MM-DD"), sorted by start time. A null day (no
 *  date resolved yet) matches nothing. */
export function eventsForDay(events: ScheduleEvent[], day: string | null): ScheduleEvent[] {
  return events
    .filter((e) => e.day === day)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
}

/** The dinner scheduled for a day, if any. */
export function dinnerForDay(dinners: Dinner[], day: string | null): Dinner | undefined {
  return dinners.find((d) => d.day === day);
}

/** One item on a day's agenda — a schedule event or that night's dinner. */
export type DayItem =
  | { kind: "event"; event: ScheduleEvent }
  | { kind: "dinner"; dinner: Dinner };

/**
 * A day's events and its dinner merged into ONE list in start-time order, so
 * the dinner slots into the timeline where it actually falls (e.g. a 5:30 PM
 * dinner lands *before* a 6:30 PM event) instead of always being pinned to the
 * bottom of the day. Items with no set time (a "TBD" dinner/event) sort to the
 * end. Stable for equal times, so a tie keeps events before the dinner.
 */
export function dayTimeline(events: ScheduleEvent[], dinner: Dinner | undefined): DayItem[] {
  const items: DayItem[] = events.map((event) => ({ kind: "event", event }));
  if (dinner) items.push({ kind: "dinner", dinner });
  const key = (it: DayItem) => timeToMinutes(it.kind === "event" ? it.event.start : it.dinner.time);
  return items.sort((a, b) => key(a) - key(b));
}
