"use client";

import { useState } from "react";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { useEvents } from "@/lib/hooks";
import { EMPTY_SUMMARY, effectiveStatus, eventDays, goingByDay } from "@/lib/events";
import { formatDateLong } from "@/lib/format";
import { useIdentity } from "@/components/IdentityProvider";
import { AttendanceControl } from "@/components/AttendanceControl";
import { EventSheet } from "@/components/EventSheet";

// The Family Fest RSVP, surfaced near the top of the Family Fest hub: tap Going or
// Can't make (no Maybe for fest planning), see how many are here each day, and tap
// through to pick your days / see who's coming (the shared EventSheet). Scoped to
// the synthesized Family Fest event so it's the same attendance shown on Home and
// /events. Renders nothing until mounted/loaded.
const FEST_EVENT_ID = "family-fest-2026";

export function FestRsvp() {
  const { today } = useDemoDate();
  const { isAdmin } = useIdentity();
  const { events, summaries, mine, loading, setStatus } = useEvents();
  const [open, setOpen] = useState(false);
  // Which day to open the sheet on (null = the overview / "Everyone").
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const openSheet = (day: string | null = null) => {
    setFocusDay(day);
    setOpen(true);
  };

  if (!today || loading) return null;
  const event = events.find((e) => e.id === FEST_EVENT_ID);
  if (!event) return null;

  const m = mine[event.id] ?? null;
  const myStatus = m ? effectiveStatus(m.status, m.days) : null;
  const summary = summaries[event.id] ?? EMPTY_SUMMARY;
  const c = summary.counts;
  const counts = [
    c.going ? `${c.going} going` : null,
    c.notGoing ? `${c.notGoing} can’t make` : null,
  ].filter(Boolean);

  // Per-day going counts (everyone sees these), tap-through to the day picker.
  const days = event.dayRsvp ? eventDays(event.startDate, event.endDate) : [];
  const byDay = goingByDay(summary.going, days);

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Are you coming to Family Fest?</p>
        <button onClick={() => openSheet()} className="press shrink-0 text-xs font-medium text-primary">
          Who&rsquo;s coming ›
        </button>
      </div>

      <AttendanceControl value={myStatus} onChange={(s) => setStatus(event.id, s)} hideMaybe />

      {days.length > 1 && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/55">
              {myStatus === "going" ? "Which days you’ll be here" : "Who’s here each day"}
            </span>
            <button onClick={() => openSheet()} className="press shrink-0 text-xs font-medium text-primary">
              Pick your days ›
            </button>
          </div>
          <div className="grid grid-flow-col auto-cols-[minmax(48px,1fr)] gap-1.5 overflow-x-auto">
            {days.map((day) => {
              const d = new Date(`${day}T00:00:00`);
              const count = byDay[day]?.length ?? 0;
              const on =
                myStatus === "going" &&
                (!m?.days || Object.keys(m.days).length === 0 || m.days[day] === "going");
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => openSheet(day)}
                  aria-label={`${formatDateLong(day)} — ${count} going. Tap to see who’s here.`}
                  className={`press flex flex-col items-center gap-0.5 rounded-xl py-1.5 ring-1 ${
                    on ? "bg-primary text-white ring-primary" : "bg-background text-foreground/70 ring-border"
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-75">
                    {d.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                  <span className="text-sm font-bold leading-none">{d.getDate()}</span>
                  <span
                    className={`text-[10px] font-semibold ${
                      on ? "text-white/85" : count > 0 ? "text-primary" : "text-foreground/35"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 px-0.5 text-[11px] text-foreground/45">Tap a day to see who’s coming that day.</p>
        </div>
      )}

      <p className="text-xs text-foreground/55">
        {counts.length ? counts.join(" · ") : "No RSVPs yet — be the first"}
      </p>

      {open && (
        <EventSheet
          event={event}
          summary={summary}
          mine={m}
          today={today}
          onSetStatus={(s, days) => setStatus(event.id, s, days)}
          onClose={() => setOpen(false)}
          isAdmin={isAdmin}
          initialDay={focusDay}
        />
      )}
    </section>
  );
}
