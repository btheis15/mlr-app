"use client";

import Link from "next/link";
import { useFestSeason } from "@/lib/useFestSeason";
import { FAMILY_FEST } from "@/lib/data";
import { CollapsibleSection } from "@/components/CollapsibleSection";

// The resort destinations on Home, as COLLAPSED groups so the default screen
// stays short and calm for a mostly-non-technical, all-ages crowd. Each group's
// header previews what's inside (the subtitle lists the items), so nothing feels
// hidden — tap to open the tiles. Same accordion the Profile tab uses, so it's
// familiar. Work Weekends drops out during the fest week (unchanged rule).
//
//   Get involved      → Events · Committees · Work Weekends
//   Around the resort → Cabin Stay · People · Local Places

interface TileDef {
  href: string;
  emoji: string;
  title: string;
  body: string;
  tile: string;
}

export function HomeResortGroups() {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (!season) return null;

  const getInvolved: TileDef[] = [
    { href: "/events", emoji: "📅", title: "Events", body: "The calendar — RSVP to what's coming.", tile: "bg-sun/12" },
    { href: "/committees", emoji: "🤝", title: "Committees", body: "Who runs what — and how to help.", tile: "bg-campfire/12" },
    ...(!season.isLive
      ? [{ href: "/work-weekends", emoji: "🛠️", title: "Work Weekends", body: "Pitch in to get the resort ready.", tile: "bg-lake/12" }]
      : []),
  ];

  const aroundResort: TileDef[] = [
    { href: "/request-stay", emoji: "🏡", title: "Cabin Stay", body: "Reserve a room for any week.", tile: "bg-dusk/12" },
    { href: "/people", emoji: "👥", title: "People", body: "Find any member — text, call, or pay.", tile: "bg-primary/12" },
    { href: "/local-places", emoji: "📍", title: "Local Places", body: "Tee times, food & favorites nearby.", tile: "bg-lake/12" },
  ];

  return (
    <div className="space-y-3">
      <CollapsibleSection title="Get involved" icon="🗓️" subtitle={getInvolved.map((t) => t.title).join(" · ")}>
        <TileGrid tiles={getInvolved} />
      </CollapsibleSection>
      <CollapsibleSection title="Around the resort" icon="🧭" subtitle={aroundResort.map((t) => t.title).join(" · ")}>
        <TileGrid tiles={aroundResort} />
      </CollapsibleSection>
    </div>
  );
}

function TileGrid({ tiles }: { tiles: TileDef[] }) {
  // Odd count ⇒ last tile spans full width, so a row never has a lonely half-card.
  const odd = tiles.length % 2 === 1;
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t, i) => (
        <TileCard key={t.href} {...t} wide={odd && i === tiles.length - 1} />
      ))}
    </div>
  );
}

function TileCard({ href, emoji, title, body, tile, wide }: TileDef & { wide?: boolean }) {
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
