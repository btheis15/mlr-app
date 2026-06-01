"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * Resort cards shown on the home in the run-up to Family Fest (and the rest of
 * the year) — but not during the live week, when the home leads with the fest.
 * Work Weekends + Committees today; more (Prep needed, etc.) can join here.
 */
export function HomePreFestCards() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  // Hidden until we know the season, and during the live week.
  if (!season || season.isLive) return null;

  return (
    <section className="grid grid-cols-2 gap-3">
      <Card
        href="/work-weekends"
        emoji="🛠️"
        title="Work Weekends"
        body="Pitch in to get the resort ready."
        chip="bg-lake/12 text-lake"
      />
      <Card
        href="/committees"
        emoji="🤝"
        title="Committees"
        body="Who runs what — and how to help."
        chip="bg-campfire/12 text-campfire"
      />
    </section>
  );
}

function Card({
  href,
  emoji,
  title,
  body,
  chip,
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
  chip: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
    >
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl ${chip}`}>
        {emoji}
      </span>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
