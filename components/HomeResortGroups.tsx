import Link from "next/link";
import { RowLink } from "@/components/RowLink";
import { CollapsibleSection } from "@/components/CollapsibleSection";

// The resort destinations on Home, as collapsed groups (the same accordion the
// Profile page uses) so the screen stays short for a mostly-non-technical,
// all-ages crowd. Each header previews its contents. Split into two so Home can
// order them by importance: "Get involved" rides high (right under the upcoming
// events), "Around the resort" sits lower, below the Ask-for-Help / People row.

// Get involved → Events & Work Weekends · Committees. The most important ask
// (volunteering / committees), so it's placed high on Home. Both cards are
// full-width with an inviting line, to pull people in.
export function HomeGetInvolved() {
  return (
    <CollapsibleSection title="Get involved" icon="🗓️" subtitle="Events & Work Weekends · Committees">
      <RowLink
        href="/events"
        emoji="📅"
        tile="bg-sun/12"
        title="Events & Work Weekends"
        subtitle="See what's coming up — RSVP to gatherings and grab a spot on a work weekend."
      />
      <RowLink
        href="/committees"
        emoji="🤝"
        tile="bg-campfire/12"
        title="Committees"
        subtitle="Join a crew and help make the resort & Family Fest happen — there's a spot for everyone."
      />
    </CollapsibleSection>
  );
}

// Around the resort → Cabin Stay · Local Places. Secondary destinations, kept
// lower on Home (below Get involved and the Ask-for-Help / People row).
export function HomeAroundResort() {
  return (
    <CollapsibleSection title="Around the resort" icon="🧭" subtitle="Cabin Stay · Local Places">
      <div className="grid grid-cols-2 gap-3">
        <TileCard href="/request-stay" emoji="🏡" title="Cabin Stay" body="Reserve a room for any week." tile="bg-dusk/12" />
        <TileCard href="/local-places" emoji="📍" title="Local Places" body="Tee times, food & favorites nearby." tile="bg-lake/12" />
      </div>
    </CollapsibleSection>
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
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl ${tile}`}>{emoji}</span>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
