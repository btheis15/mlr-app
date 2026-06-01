"use client";

import Link from "next/link";
import { Countdown } from "@/components/Countdown";
import { useFestSeason } from "@/lib/useFestSeason";
import { useDemoDate } from "@/lib/DemoDateProvider";
import { formatTime } from "@/lib/format";
import type { ScheduleEvent, Dinner } from "@/lib/types";

/**
 * The focal block at the top of the Family Fest section. During the event week
 * it surfaces EVERYTHING for today inline — each event with time, location,
 * description, what to bring, and who's in charge (tap-to-call/text), plus
 * tonight's dinner with the head chef — so nobody has to dig the day of. Before
 * the week it's a countdown (+ volunteer prompt while planning); after, a
 * "post your photos" nudge.
 */
export function FestStatus({
  startDate,
  endDate,
  events,
  dinners,
  volunteerContact,
}: {
  startDate: string;
  endDate: string;
  events: ScheduleEvent[];
  dinners: Dinner[];
  volunteerContact?: { name: string; email: string; phone: string };
}) {
  const season = useFestSeason(startDate, endDate);
  const { today: t } = useDemoDate();

  if (season?.isLive) {
    const today = events
      .filter((e) => e.day === t)
      .sort((a, b) => a.start.localeCompare(b.start));
    const dinner = dinners.find((d) => d.day === t);
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-primary/10 p-4 text-center">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            Happening today
          </p>
          <p className="mt-1 text-xl font-bold text-primary">
            Day {season.dayNumber} of {season.totalDays}
          </p>
          <p className="text-sm text-foreground/60">
            Everything you need for today, right here.
          </p>
        </div>

        {today.map((e) => (
          <TodayEvent key={e.id} e={e} />
        ))}
        {dinner && <TodayDinner d={dinner} />}
        {today.length === 0 && !dinner && (
          <p className="rounded-2xl bg-card p-4 text-center text-sm text-foreground/60 ring-1 ring-border">
            Nothing scheduled today — enjoy the lake! 🛶
          </p>
        )}
      </div>
    );
  }

  if (season?.isWrap) {
    return (
      <div className="rounded-2xl bg-primary/10 p-4 text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.15em] text-primary">
          That&rsquo;s a wrap
        </p>
        <p className="mt-1 text-lg font-bold text-primary">Thanks for a great week 🎆</p>
        <p className="mt-1 text-sm text-foreground/60">
          Post any photos you didn&rsquo;t get to share
          {season.wrapDaysLeft > 0
            ? ` — the album's open ${season.wrapDaysLeft} more day${season.wrapDaysLeft === 1 ? "" : "s"}.`
            : "."}
        </p>
        <Link href="/photos" className="mt-2 inline-block text-sm font-semibold text-primary">
          Add your photos →
        </Link>
      </div>
    );
  }

  // off-season / planning
  return (
    <div className="space-y-3">
      <Countdown target={startDate} />
      {season?.isPlanning && volunteerContact && (
        <VolunteerContact contact={volunteerContact} />
      )}
    </div>
  );
}

/** Today's event, fully expanded — the day-of detail people need at a glance. */
function TodayEvent({ e }: { e: ScheduleEvent }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex gap-3">
        <span className="text-2xl">{e.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{e.title}</h3>
            <span className="shrink-0 text-xs font-medium text-accent">
              {formatTime(e.start)}
              {e.end ? `–${formatTime(e.end)}` : ""}
            </span>
          </div>
          <p className="text-xs text-foreground/50">📍 {e.location}</p>
          <p className="mt-1 text-xs text-foreground/70">{e.description}</p>
          {e.bring && (
            <p className="mt-1 text-xs text-foreground/60">
              🎒 <span className="text-foreground/40">Bring:</span> {e.bring}
            </p>
          )}
        </div>
      </div>
      {e.lead && <Contact label="In charge" name={e.lead.name} phone={e.lead.phone} />}
    </div>
  );
}

/** Tonight's dinner, expanded — menu + head chef contact. */
function TodayDinner({ d }: { d: Dinner }) {
  return (
    <div className="rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20">
      <div className="flex gap-3">
        <span className="text-2xl">{d.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Dinner · {d.title}</h3>
            <span className="shrink-0 text-xs font-medium text-accent">{d.time}</span>
          </div>
          <p className="text-xs text-foreground/50">
            📍 {d.location} · prep starts {d.prepTime}
          </p>
          <p className="mt-1 text-xs text-foreground/70">{d.menu}</p>
        </div>
      </div>
      <Contact label="Head chef" name={d.chef.name} phone={d.chef.phone} />
    </div>
  );
}

function Contact({ label, name, phone }: { label: string; name: string; phone: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
      <p className="min-w-0 flex-1 truncate text-xs text-foreground/60">
        <span className="text-foreground/40">{label}:</span> {name}
      </p>
      <a
        href={`tel:${phone}`}
        aria-label={`Call ${name}`}
        className="rounded-full bg-primary/10 px-2.5 py-1.5 text-xs text-primary"
      >
        📞
      </a>
      <a
        href={`sms:${phone}`}
        aria-label={`Text ${name}`}
        className="rounded-full bg-accent/10 px-2.5 py-1.5 text-xs text-accent"
      >
        💬
      </a>
    </div>
  );
}

function VolunteerContact({
  contact,
}: {
  contact: { name: string; email: string; phone: string };
}) {
  const mailto = `mailto:${contact.email}?subject=${encodeURIComponent(
    "Family Fest — I'd like to help out",
  )}`;
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <p className="text-center text-sm font-semibold text-primary">
        🙋 Want to help plan Family Fest?
      </p>
      <p className="mt-0.5 text-center text-xs text-foreground/60">
        Reach out to {contact.name}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href={mailto}
          className="rounded-xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary"
        >
          ✉️ Email
        </a>
        <a
          href={`tel:${contact.phone}`}
          className="rounded-xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary"
        >
          📞 Call
        </a>
      </div>
    </div>
  );
}
