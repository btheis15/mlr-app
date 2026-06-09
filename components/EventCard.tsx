"use client";

import type { AttendanceStatus, AttendanceSummary, EventKind, ResortEvent } from "@/lib/types";
import { formatDateRange, relativeDays } from "@/lib/format";
import { isOngoing } from "@/lib/events";
import { AttendanceControl } from "@/components/AttendanceControl";

// One event on the resort calendar. Three shapes from one component:
//  • "spotlight" — the nearest event on Home: full card + inline RSVP + "UP NEXT".
//  • "card"      — a list item on /events: full card + inline RSVP.
//  • "compact"   — a quiet one-line row (Home's secondary events, past events).
// Tapping the card (outside the RSVP buttons) opens the detail sheet.

const KIND_CHIP: Record<EventKind, string> = {
  family_fest: "bg-campfire/12 text-campfire",
  work_weekend: "bg-lake/12 text-lake",
  holiday: "bg-sun/12 text-sun",
  custom: "bg-dusk/12 text-dusk",
};

function whenLabel(event: ResortEvent, today: string): string {
  if (isOngoing(event, today)) return "Happening now";
  return relativeDays(today, event.startDate) ?? "";
}

/** "● 12 going · 3 maybe · 2 can't make", with colored dots; a quiet hint when empty. */
function CountChips({ counts }: { counts: AttendanceSummary["counts"] }) {
  if (counts.going === 0 && counts.maybe === 0 && counts.notGoing === 0) {
    return <span className="text-xs text-foreground/40">No RSVPs yet — be the first</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/60">
      {counts.going > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
          {counts.going} going
        </span>
      )}
      {counts.maybe > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sun" aria-hidden />
          {counts.maybe} maybe
        </span>
      )}
      {counts.notGoing > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-foreground/30" aria-hidden />
          {counts.notGoing} can&rsquo;t make
        </span>
      )}
    </span>
  );
}

export function EventCard({
  event,
  summary,
  myStatus,
  today,
  onOpen,
  onSetStatus,
  variant = "card",
}: {
  event: ResortEvent;
  summary: AttendanceSummary;
  /** The viewer's effective RSVP, or null. */
  myStatus: AttendanceStatus | null;
  today: string;
  onOpen: () => void;
  /** Inline RSVP handler (full variants only). Omit to hide the control. */
  onSetStatus?: (status: AttendanceStatus) => void;
  variant?: "spotlight" | "card" | "compact";
}) {
  const chip = KIND_CHIP[event.kind];
  const when = whenLabel(event, today);

  // Compact one-liner.
  if (variant === "compact") {
    const total = summary.counts.going + summary.counts.maybe;
    return (
      <button
        onClick={onOpen}
        className="press flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left ring-1 ring-border transition-shadow hover:shadow-sm"
      >
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg ${chip}`}>
          {event.emoji ?? "📅"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{event.title}</span>
          <span className="block truncate text-xs text-foreground/55">
            {formatDateRange(event.startDate, event.endDate)}
            {when && ` · ${when}`}
            {total > 0 && ` · ${summary.counts.going} going`}
          </span>
        </span>
        <span className="ml-1 text-lg leading-none text-foreground/40" aria-hidden>
          ›
        </span>
      </button>
    );
  }

  // Full card (spotlight or list).
  const spotlight = variant === "spotlight";
  return (
    <div
      className={`rounded-2xl bg-card p-4 ring-1 transition-shadow hover:shadow-sm ${
        spotlight ? "ring-primary/25" : "ring-border"
      }`}
    >
      <button onClick={onOpen} className="press flex w-full items-start gap-3 text-left">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${chip}`}>
          {event.emoji ?? "📅"}
        </span>
        <span className="min-w-0 flex-1">
          {spotlight && (
            <span className="text-[11px] font-bold uppercase tracking-wide text-primary/70">Up next</span>
          )}
          <span className="block text-sm font-semibold">{event.title}</span>
          <span className="mt-0.5 block text-xs text-foreground/55">
            {formatDateRange(event.startDate, event.endDate)}
            {when && <span className="font-medium text-accent"> · {when}</span>}
          </span>
        </span>
        <span className="ml-1 text-lg leading-none text-foreground/40" aria-hidden>
          ›
        </span>
      </button>

      <div className="mt-3">
        <CountChips counts={summary.counts} />
      </div>

      {onSetStatus && (
        <div className="mt-3">
          <AttendanceControl value={myStatus} onChange={onSetStatus} />
        </div>
      )}
    </div>
  );
}
