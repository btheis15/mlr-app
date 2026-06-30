"use client";

import Link from "next/link";

/**
 * "Ask for Help" + "People" as side-by-side square tiles, sitting just under
 * Get involved on Home.
 *
 * Tagged `data-fit-anchor` so AppHeader sizes the hero logo to land this row as
 * the last fully-visible thing above the tab bar (Around the resort + below sit
 * just past the fold).
 */
export function HomeHelpPeople() {
  return (
    <div data-fit-anchor className="grid grid-cols-2 gap-3">
      <Tile
        href="/help-requests"
        emoji="🙌"
        tile="bg-primary/12"
        title="Ask for Help"
        body="Need a hand at the resort? Ask — or help out."
      />
      <Tile
        href="/people"
        emoji="👥"
        tile="bg-lake/12"
        title="People"
        body="Find & contact everyone at the resort."
      />
    </div>
  );
}

function Tile({
  href,
  emoji,
  title,
  body,
  tile,
  className = "",
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
  tile: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`press rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm ${className}`}
    >
      <span aria-hidden className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${tile}`}>
        {emoji}
      </span>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
