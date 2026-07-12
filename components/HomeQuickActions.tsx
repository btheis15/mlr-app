import Link from "next/link";

/**
 * Home quick actions — the always-visible navigation grid that replaced the two
 * default-collapsed accordions ("Communication" and "Around the resort"), which
 * buried People / Committees / Lend a Hand / Events / Cabin Stay / Local Places
 * behind an extra tap. Every destination those groups linked to is a big
 * tappable tile here, ordered roughly by family usage (Events · People · Cabin
 * Stay first).
 *
 * Tagged `data-fit-anchor` so the hero logo sizes to land this grid as the last
 * fully-visible thing above the tab bar (see lib/appLogoFit.ts — the "no
 * upcoming events" fallback anchor lives on the App & help group in
 * app/page.tsx).
 *
 * The Lend a Hand tile deliberately mirrors how the old "Ask for Help" row
 * behaved: always visible, plain link — /help-requests itself handles the
 * beta/sign-in state (HelpRequestsView), so nothing is gated at the tile.
 */

const ACTIONS: {
  href: string;
  emoji: string;
  tile: string;
  label: string;
  sub: string;
}[] = [
  { href: "/events", emoji: "📅", tile: "bg-sun/12", label: "Events", sub: "RSVP — gatherings & work weekends." },
  { href: "/people", emoji: "👥", tile: "bg-lake/12", label: "People", sub: "Find & contact everyone." },
  { href: "/request-stay", emoji: "🏡", tile: "bg-dusk/12", label: "Cabin Stay", sub: "Reserve a room for any week." },
  { href: "/help-requests", emoji: "🙌", tile: "bg-primary/12", label: "Lend a Hand", sub: "Ask for a hand — or help out." },
  { href: "/local-places", emoji: "📍", tile: "bg-lake/12", label: "Local Places", sub: "Tee times, food & favorites." },
  { href: "/committees", emoji: "🤝", tile: "bg-campfire/12", label: "Committees", sub: "Join a crew — there's a spot for you." },
];

export function HomeQuickActions() {
  return (
    <nav data-fit-anchor aria-label="Quick actions" className="grid grid-cols-2 gap-3">
      {ACTIONS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="press flex min-h-[88px] flex-col justify-center rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
        >
          <span
            aria-hidden
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[28px] leading-none ${a.tile}`}
          >
            {a.emoji}
          </span>
          <span className="mt-2 text-sm font-semibold">{a.label}</span>
          <span className="mt-0.5 text-xs text-foreground/60">{a.sub}</span>
        </Link>
      ))}
    </nav>
  );
}
