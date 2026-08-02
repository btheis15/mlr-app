import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";

/**
 * Home quick actions — the always-visible navigation grid that replaced the two
 * default-collapsed accordions ("Communication" and "Around the resort"), which
 * buried People / Committees / Ask for Help / Events / Cabin Stay / Local Places
 * behind an extra tap. Every destination those groups linked to is a big
 * tappable tile here. Row order is Brian's: Events · Committees / People ·
 * Ask for Help / Local Places · Cabin Stay.
 *
 * Tagged `data-fit-anchor` so the hero logo sizes to land this grid as the last
 * fully-visible thing above the tab bar (see lib/appLogoFit.ts — the "no
 * upcoming events" fallback anchor lives on the App & help group in
 * app/page.tsx).
 *
 * The Ask for Help tile deliberately mirrors how the old "Ask for Help" row
 * behaved: always visible, plain link — /help-requests itself handles the
 * sign-in state (HelpRequestsView), so nothing is gated at the tile.
 */

// Each tile's icon-square keeps its color-token tint (`bg-*/12`) and the line
// icon (components/Icon.tsx) inherits the matching full-strength text token
// via currentColor, so the pair always reads as one hue.
const ACTIONS: {
  href: string;
  icon: IconName;
  tile: string;
  label: string;
  sub: string;
}[] = [
  { href: "/events", icon: "calendar", tile: "bg-sun/12 text-sun", label: "Events", sub: "RSVP — gatherings & work weekends." },
  { href: "/committees", icon: "users", tile: "bg-campfire/12 text-campfire", label: "Committees", sub: "Join a crew — there's a spot for you." },
  { href: "/people", icon: "people", tile: "bg-lake/12 text-lake", label: "People", sub: "Find & contact everyone." },
  { href: "/help-requests", icon: "hand", tile: "bg-primary/12 text-primary", label: "Ask for Help", sub: "Request a hand at the resort." },
  { href: "/local-places", icon: "pin", tile: "bg-lake/12 text-lake", label: "Local Places", sub: "Tee times, food & favorites." },
  { href: "/request-stay", icon: "cabin", tile: "bg-dusk/12 text-dusk", label: "Cabin Stay", sub: "Reserve a room for any week." },
  { href: "/drop", icon: "images", tile: "bg-campfire/12 text-campfire", label: "Drop Box", sub: "Dump & share photos — everyone can grab them." },
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
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${a.tile}`}
          >
            <Icon name={a.icon} size={26} />
          </span>
          <span className="mt-2 text-sm font-semibold">{a.label}</span>
          <span className="mt-0.5 text-xs text-foreground/60">{a.sub}</span>
        </Link>
      ))}
    </nav>
  );
}
