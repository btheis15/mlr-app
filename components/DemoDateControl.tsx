"use client";

import { useDemoDate } from "@/lib/DemoDateProvider";
import { FAMILY_FEST, eventDays } from "@/lib/data";
import { toISODate } from "@/lib/festSeason";
import { formatDate } from "@/lib/format";

/** Shift an ISO date by N days, returning local ISO "YYYY-MM-DD". */
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/**
 * Testing/demo tool: "see the app as if it's this day." Sets a device-local
 * date override (DemoDateProvider) so you can preview the run-up, each day of
 * the live week, and the after/wrap state without waiting for the calendar.
 */
export function DemoDateControl() {
  const { demoDate, setDemoDate, today } = useDemoDate();
  const days = eventDays();
  const runUp = shift(FAMILY_FEST.startDate, -10); // planning window
  const after = shift(FAMILY_FEST.endDate, 3); // wrap window

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${
      active ? "bg-primary text-white ring-primary" : "bg-background text-foreground/70 ring-border"
    }`;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-accent">🧪 Demo — see the app as a day</h2>
      <p className="text-xs text-foreground/50">
        Preview how Family Fest looks on a given day (countdown, the live week,
        the after-wrap). This only changes what you see on this device.
      </p>
      <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <p className="text-xs text-foreground/60">
          Showing:{" "}
          <span className="font-semibold text-foreground">
            {demoDate ? `${formatDate(demoDate)} (simulated)` : "Today (real date)"}
          </span>
        </p>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setDemoDate(runUp)} className={pill(demoDate === runUp)}>
            Run-up
          </button>
          {days.map((d, i) => (
            <button key={d} onClick={() => setDemoDate(d)} className={pill(demoDate === d)}>
              Day {i + 1}
            </button>
          ))}
          <button onClick={() => setDemoDate(after)} className={pill(demoDate === after)}>
            After
          </button>
        </div>

        <label className="block text-xs text-foreground/60">
          Or pick any date
          <input
            type="date"
            value={demoDate ?? today ?? ""}
            onChange={(e) => setDemoDate(e.target.value || null)}
            className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </label>

        {demoDate && (
          <button
            onClick={() => setDemoDate(null)}
            className="w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary"
          >
            Reset to today&rsquo;s real date
          </button>
        )}
      </div>
    </section>
  );
}
