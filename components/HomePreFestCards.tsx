"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * Resort cards on the home. Committees stays available year-round (including
 * during the fest week — people message / sign up while everyone's together).
 * Work Weekends never happen during the week, so it's hidden then and returns
 * once the fest is over.
 */
export function HomePreFestCards() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season) return null;
  const showWorkWeekends = !season.isLive;

  return (
    <section className={`grid gap-3 ${showWorkWeekends ? "grid-cols-2" : "grid-cols-1"}`}>
      {showWorkWeekends && (
        <Card
          href="/work-weekends"
          emoji="🛠️"
          title="Work Weekends"
          body="Pitch in to get the resort ready."
          chip="bg-lake/12 text-lake"
        />
      )}
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
      className="press rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
    >
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl ${chip}`}>
        {emoji}
      </span>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
