import Link from "next/link";
import { RowLink } from "@/components/RowLink";
import { CollapsibleSection } from "@/components/CollapsibleSection";

// The resort destinations on Home, in two collapsed groups (the same accordion
// the Profile tab uses) so the screen stays short for a mostly-non-technical,
// all-ages crowd. Each header previews its contents.
//
//   Get involved      → Events & Work Weekends · Committees   (horizontal, "come help" cards)
//   Around the resort → Cabin Stay · People · Local Places    (tiles)
//
// Events and Work Weekends are one card now (work weekends are just events) and
// both Get-involved cards are full-width with an inviting line, to pull people in.
export function HomeResortGroups() {
  return (
    <div className="space-y-3">
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

      <CollapsibleSection title="Around the resort" icon="🧭" subtitle="Cabin Stay · People · Local Places">
        <div className="grid grid-cols-2 gap-3">
          <TileCard href="/request-stay" emoji="🏡" title="Cabin Stay" body="Reserve a room for any week." tile="bg-dusk/12" />
          <TileCard href="/people" emoji="👥" title="People" body="Find any member — text, call, or pay." tile="bg-primary/12" />
          <TileCard href="/local-places" emoji="📍" title="Local Places" body="Tee times, food & favorites nearby." tile="bg-lake/12" wide />
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
  wide,
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
  tile: string;
  wide?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`press rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm ${wide ? "col-span-2" : ""}`}
    >
      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl ${tile}`}>{emoji}</span>
      <h3 className="mt-2 text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-foreground/60">{body}</p>
    </Link>
  );
}
