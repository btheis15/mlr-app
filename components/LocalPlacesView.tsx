"use client";

import Link from "next/link";
import { LocalPlaceCard } from "@/components/LocalPlaceCard";
import { PlacesGroup } from "@/components/PlacesGroup";
import { useIdentity } from "@/components/IdentityProvider";
import { useCachedResource } from "@/lib/swrCache";
import { fetchLocalPlaces, groupKeys, groupTitle, KNOWN_GROUPS, PLACES, type LocalPlace } from "@/lib/places";

const FALLBACK = { places: PLACES, fromDb: false };

/** The /local-places body: reads the `local_places` table (migration 0225) via
 *  the shared SWR cache (first paint = the in-code list; it only stays if the
 *  read errors), then renders one collapsible section per group. */
export function LocalPlacesView() {
  const { isAdmin } = useIdentity();
  const { data } = useCachedResource("localPlaces", FALLBACK, fetchLocalPlaces, { persist: "local" });
  const places: LocalPlace[] = data.places.filter((p) => p.isActive !== false);

  return (
    <div className="space-y-3">
      {isAdmin && (
        <Link
          href="/admin/local-places"
          className="press inline-flex rounded-full bg-card px-3.5 py-1.5 text-xs font-semibold text-primary ring-1 ring-border"
        >
          ✏️ Edit places
        </Link>
      )}
      {groupKeys(places).map((g) => {
        const list = places.filter((p) => p.group === g);
        const known = KNOWN_GROUPS[g];
        return (
          <PlacesGroup
            key={g}
            title={groupTitle(g)}
            emoji={known?.emoji ?? "📍"}
            accent={known?.accent ?? "lake"}
            count={list.length}
          >
            {list.map((place) => (
              <LocalPlaceCard key={place.slug} place={place} />
            ))}
          </PlacesGroup>
        );
      })}
    </div>
  );
}
