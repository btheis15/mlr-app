import { RowLink } from "@/components/RowLink";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import Link from "next/link";

// Communication → People · Committees · Ask for Help.
// Placed right after events on Home. Tagged data-fit-anchor so the hero logo
// sizes to land just above this section (see lib/appLogoFit.ts).
export function HomeCommunication() {
  return (
    <div data-fit-anchor>
      <CollapsibleSection title="Communication" icon="💬" subtitle="People · Committees · Ask for Help">
        <RowLink
          href="/people"
          emoji="👥"
          tile="bg-lake/12"
          title="People"
          subtitle="Find & contact everyone at the resort."
        />
        <RowLink
          href="/committees"
          emoji="🤝"
          tile="bg-campfire/12"
          title="Committees"
          subtitle="Join a crew and help make the resort & Family Fest happen — there's a spot for everyone."
        />
        <RowLink
          href="/help-requests"
          emoji="🙌"
          tile="bg-primary/12"
          title="Ask for Help"
          subtitle="Need a hand at the resort? Ask — or help out."
        />
      </CollapsibleSection>
    </div>
  );
}

// Around the resort → Events & Work Weekends · Cabin Stay · Local Places.
// Sits below Communication on Home. (The Work Checklist is now its own
// standalone expandable card on Home — see app/page.tsx.)
//
// Tagged data-fit-anchor-empty: when Home has no upcoming events, the hero
// logo anchors on THIS group instead — see lib/appLogoFit.ts.
export function HomeAroundResort() {
  return (
    <div data-fit-anchor-empty>
      <CollapsibleSection title="Around the resort" icon="🧭" subtitle="Events · Cabin Stay · Local Places">
        <RowLink
          href="/events"
          emoji="📅"
          tile="bg-sun/12"
          title="Events & Work Weekends"
          subtitle="See what's coming up — RSVP to gatherings and grab a spot on a work weekend."
        />
        <div className="grid grid-cols-2 gap-3">
          <TileCard href="/request-stay" emoji="🏡" title="Cabin Stay" body="Reserve a room for any week." tile="bg-dusk/12" />
          <TileCard href="/local-places" emoji="📍" title="Local Places" body="Tee times, food & favorites nearby." tile="bg-lake/12" />
        </div>
      </CollapsibleSection>
    </div>
  );
}

function TileCard({
  href,
  emoji,
  title,
  body,
  tile,
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
  tile: string;
}) {
  return (
    <Link
      href={href}
      className="press rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm"
    >
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${tile}`}>{emoji}</span>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
