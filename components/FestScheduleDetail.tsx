"use client";

import { BackLink } from "@/components/BackLink";
import { Protected, PrivateName } from "@/components/Guard";
import { CallTextButtons } from "@/components/CallTextButtons";
import { useFestContent } from "@/lib/useFestContent";
import { formatDateLong, formatTime } from "@/lib/format";
import type { ScheduleEvent } from "@/lib/types";

/**
 * One schedule event, drilled in. Reads the live event from the shared content
 * (so Planner edits show here) and falls back to the seed event the static page
 * passed in — which is also what makes pre-rendered seed routes work offline.
 * A brand-new (DB-only) event resolves at request time; if it can't be found
 * at all we say so rather than 404 hard.
 */
export function FestScheduleDetail({ id, fallback }: { id: string; fallback: ScheduleEvent | null }) {
  const { schedule } = useFestContent({ realtime: true });
  const event = schedule.find((e) => e.id === id) ?? fallback;

  if (!event) {
    return (
      <div className="space-y-5 pt-1">
        <BackLink href="/family-fest" label="Family Fest" />
        <p className="rounded-2xl bg-card p-4 text-center text-sm text-foreground/60 ring-1 ring-border">
          This event isn&rsquo;t on the schedule anymore.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />

      <header className="space-y-1">
        <p className="text-xs text-foreground/50">
          {formatDateLong(event.day)} · {formatTime(event.start)}
          {event.end ? `–${formatTime(event.end)}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="mr-1">{event.emoji}</span>
          {event.title}
        </h1>
        <p className="text-sm text-foreground/60">📍 <Protected label="Sign in for location">{event.location}</Protected></p>
      </header>

      <p className="text-sm leading-relaxed text-foreground/80">{event.description}</p>

      {event.bring && (
        <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">
            What to bring
          </h2>
          <p className="mt-1 text-sm text-foreground/80">{event.bring}</p>
        </section>
      )}

      {event.lead && (
        <section className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <p className="text-[11px] uppercase tracking-wide text-foreground/40">In charge</p>
          <p className="mt-0.5 text-sm font-semibold"><PrivateName name={event.lead.name} /></p>
          <div className="mt-3">
            <CallTextButtons phone={event.lead.phone} />
          </div>
        </section>
      )}
    </div>
  );
}
