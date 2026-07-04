"use client";

import { useResolvedHouse } from "@/lib/hooks";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";
import { HouseCalendar } from "@/components/HouseCalendar";

/**
 * The full house-calendar screen: resolves which house to show (the viewer's own
 * by default, or a `?house=<slug>` deep-link), gates on membership, and renders
 * the month grid + agenda. Back-links to the House Hub. Same resolution + gate
 * shape as HouseHub.
 */
export function HouseCalendarScreen({ slug }: { slug?: string | null }) {
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
          <h1 className="mt-2 text-lg font-bold">{house ? house.name : "No house calendar"}</h1>
          <p className="mt-1 text-sm text-foreground/60">
            {house
              ? "This is a private house. Ask an admin to add you to see its calendar."
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
        <h1 className="text-2xl font-bold tracking-tight">📅 {house.name} calendar</h1>
        <p className="text-sm text-foreground/60">
          Who&rsquo;s going up to the house and when — add your own stay so everyone knows.
        </p>
      </header>
      <HouseCalendar houseId={house.id} houseName={house.name} />
    </div>
  );
}
