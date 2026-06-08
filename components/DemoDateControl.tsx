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
 * Testing/demo tool: "see the app as if it's this day." Pick ANY calendar date
 * to preview how the app behaves then (countdown, the live week, the
 * after-wrap, or any future/TBD day). Device-local override (DemoDateProvider);
 * the fest-day buttons are just shortcuts.
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
      <h2 className="text-sm font-semibold text-accent">🧪 Demo — see the app as any day</h2>
      <p className="text-xs text-foreground/50">
        Pick any calendar date to preview how the app looks that day — handy for
        planning things on dates that are still TBD. Only changes what you see on
        this device.
      </p>
      <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <p className="text-xs text-foreground/60">
          Showing:{" "}
          <span className="font-semibold text-foreground">
            {demoDate ? `${formatDate(demoDate)} (simulated)` : "Today (real date)"}
          </span>
        </p>

        {/* Primary: jump to ANY date */}
        <label className="block text-xs font-medium text-foreground/70">
          Jump to any date
          <input
            type="date"
            value={demoDate ?? today ?? ""}
            onChange={(e) => setDemoDate(e.target.value || null)}
            className="mt-1 block w-full min-w-0 max-w-full box-border appearance-none rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </label>

        {/* Shortcuts to the fest moments */}
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-foreground/40">Quick jumps</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setDemoDate(runUp)} className={`press ${pill(demoDate === runUp)}`}>
              Run-up
            </button>
            {days.map((d, i) => (
              <button key={d} onClick={() => setDemoDate(d)} className={`press ${pill(demoDate === d)}`}>
                Day {i + 1}
              </button>
            ))}
            <button onClick={() => setDemoDate(after)} className={`press ${pill(demoDate === after)}`}>
              After
            </button>
          </div>
        </div>

        {demoDate && (
          <button
            onClick={() => setDemoDate(null)}
            className="press w-full rounded-xl bg-primary/10 py-2 text-sm font-semibold text-primary"
          >
            Reset to today&rsquo;s real date
          </button>
        )}
      </div>
    </section>
  );
}
