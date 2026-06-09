"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";

/**
 * Resort cards on the home. Committees and Request a Cabin Stay stay available
 * year-round (including during the fest week — people sign up / book while
 * everyone's together). Work Weekends never happen during the week, so it's
 * hidden then and returns once the fest is over.
 *
 * Cards lay out in a 2-up grid; when there's an odd number the last one spans
 * the full width so the row never has a lonely half-card.
 */
interface CardProps {
  href: string;
  emoji: string;
  title: string;
  body: string;
  chip: string;
}

export function HomePreFestCards() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season) return null;

  const cards: CardProps[] = [
    {
      href: "/events",
      emoji: "📅",
      title: "Events",
      body: "The calendar — RSVP to what's coming.",
      chip: "bg-sun/12 text-sun",
    },
    ...(!season.isLive
      ? [{
          href: "/work-weekends",
          emoji: "🛠️",
          title: "Work Weekends",
          body: "Pitch in to get the resort ready.",
          chip: "bg-lake/12 text-lake",
        }]
      : []),
    {
      href: "/committees",
      emoji: "🤝",
      title: "Committees",
      body: "Who runs what — and how to help.",
      chip: "bg-campfire/12 text-campfire",
    },
    {
      href: "/request-stay",
      emoji: "🏡",
      title: "Request a Cabin Stay",
      body: "Reserve a room for Family Fest or any week.",
      chip: "bg-dusk/12 text-dusk",
    },
  ];

  const odd = cards.length % 2 === 1;

  return (
    <section className="grid grid-cols-2 gap-3">
      {cards.map((c, i) => (
        <Card key={c.href} {...c} wide={odd && i === cards.length - 1} />
      ))}
    </section>
  );
}

function Card({ href, emoji, title, body, chip, wide }: CardProps & { wide?: boolean }) {
  return (
    <Link
      href={href}
      className={`press rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm ${
        wide ? "col-span-2" : ""
      }`}
    >
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl ${chip}`}>
        {emoji}
      </span>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
