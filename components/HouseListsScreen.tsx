"use client";

import { useResolvedHouse } from "@/lib/hooks";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";
import { HouseLists } from "@/components/HouseLists";

/**
 * The house Lists screen: resolves which house to show (the viewer's own by
 * default, or a `?house=<slug>` deep-link), gates on membership, and renders the
 * house's shared lists. Back-links to the House Hub. Same resolution + gate shape
 * as HouseCalendarScreen.
 */
export function HouseListsScreen({ slug }: { slug?: string | null }) {
  const { house, isMember, loading } = useResolvedHouse(slug);
  const back = slug ? `/house?house=${slug}` : "/house";

  if (loading) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href={back} label="House" />
        <SkeletonList />
      </div>
    );
  }

  if (!house || !isMember) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href="/" label="Home" />
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">{house?.emoji ?? "🏠"}</p>
          <h1 className="mt-2 text-lg font-bold">{house ? house.name : "No house lists"}</h1>
          <p className="mt-1 text-sm text-foreground/60">
            {house
              ? "This is a private house. Ask an admin to add you to see its lists."
              : "You're not in a house yet — ask an admin to add you to yours."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-2">
      <BackLink href={back} label={house.name} />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">📝 {house.name} lists</h1>
        <p className="text-sm text-foreground/60">
          Shared lists for the house — groceries, a close-up checklist, whatever you need. Anyone in the house can
          start one and check things off.
        </p>
      </header>
      <HouseLists houseId={house.id} />
    </div>
  );
}
