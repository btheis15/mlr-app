"use client";

import Link from "next/link";
import { Countdown } from "@/components/Countdown";
import { useFestSeason } from "@/lib/useFestSeason";
import { toISODate } from "@/lib/festSeason";
import { formatTime } from "@/lib/format";
import type { FestHighlight } from "@/lib/types";

/**
 * The status block on the Family Fest hub, driven by the shared season model:
 * a countdown in the run-up, a live "Day n of N + Today at the Fest" panel
 * during the event week, and a "post your photos" panel for the two weeks after
 * (wrap) — so the hub reflects where we are in the fest season, not just a
 * clock to a fixed date. (Mirrors the same component in the family-fest app.)
 */
export function FestStatus({
  startDate,
  endDate,
  items,
  photosHref,
  volunteerContact,
}: {
  startDate: string;
  endDate: string;
  items: FestHighlight[];
  /** Where "Add your photos" points during wrap (the resort hub omits it and
   *  leans on the "Enter the full Family Fest app" link below instead). */
  photosHref?: string;
  /** Planning-season volunteer contact (tap-to-email / tap-to-call). Omit to
   *  hide the "want to help?" block. */
  volunteerContact?: { name: string; email: string; phone: string };
}) {
  const season = useFestSeason(startDate, endDate);

  if (season?.isLive) {
    const todays = items.filter((i) => i.day === toISODate());
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-primary/10 p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Happening now
          </p>
          <p className="mt-1 text-lg font-bold text-primary">
            Day {season.dayNumber} of {season.totalDays}
          </p>
          <p className="text-xs text-foreground/60">
            We&rsquo;re at the lake — welcome to Family Fest 🎆
          </p>
        </div>
        {todays.length > 0 && (
          <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
            <h2 className="text-sm font-semibold text-accent">Today at the Fest</h2>
            <ul className="mt-2 space-y-2">
              {todays.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  <span className="text-xl">{i.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.title}</p>
                    <p className="text-xs text-foreground/50">{formatTime(i.start)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (season?.isWrap) {
    return (
      <div className="rounded-2xl bg-primary/10 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          That&rsquo;s a wrap
        </p>
        <p className="mt-1 text-base font-bold text-primary">
          Thanks for a great week 🎆
        </p>
        <p className="mt-1 text-xs text-foreground/60">
          Post any photos you didn&rsquo;t get to share
          {season.wrapDaysLeft > 0
            ? ` — the album's open for ${season.wrapDaysLeft} more day${season.wrapDaysLeft === 1 ? "" : "s"}.`
            : "."}
        </p>
        {photosHref && (
          <Link
            href={photosHref}
            className="mt-2 inline-block text-xs font-semibold text-primary"
          >
            Add your photos →
          </Link>
        )}
      </div>
    );
  }

  // off-season / planning — a countdown, plus a "want to help?" contact once
  // planning is underway (~60 days out).
  return (
    <div className="space-y-3">
      <Countdown target={startDate} />
      {season?.isPlanning && volunteerContact && (
        <VolunteerContact contact={volunteerContact} />
      )}
    </div>
  );
}

/** Planning-season volunteer prompt — tap-to-email / tap-to-call the contact. */
function VolunteerContact({
  contact,
}: {
  contact: { name: string; email: string; phone: string };
}) {
  const mailto = `mailto:${contact.email}?subject=${encodeURIComponent(
    "Family Fest — I'd like to help out",
  )}`;
  return (
    <div className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <p className="text-center text-xs font-semibold text-primary">
        🙋 Want to help plan Family Fest?
      </p>
      <p className="mt-0.5 text-center text-xs text-foreground/60">
        Reach out to {contact.name}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a
          href={mailto}
          className="rounded-xl bg-primary/10 py-2 text-center text-xs font-semibold text-primary"
        >
          ✉️ Email
        </a>
        <a
          href={`tel:${contact.phone}`}
          className="rounded-xl bg-primary/10 py-2 text-center text-xs font-semibold text-primary"
        >
          📞 Call
        </a>
      </div>
    </div>
  );
}
