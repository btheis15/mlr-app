import { BackLink } from "@/components/BackLink";
import { LocalPlaceCard } from "@/components/LocalPlaceCard";
import { PlacesGroup } from "@/components/PlacesGroup";
import { PLACES } from "@/lib/places";

export const metadata = {
  title: "Local Places — Muskellunge Lake Resort",
};

/**
 * Local Places — the resort's favorite nearby spots: tee times at Inshalla
 * (handed off to our in-app /tee-times screen) plus the bars & grills we order
 * from. Each spot links straight to its menu, online ordering, phone, and site.
 * Data + ordering live in lib/places.ts; this page just groups and renders.
 *
 * The three groups are collapsible PlacesGroup cards, all collapsed by default
 * so the page opens compact instead of a long wall of cards. Each collapsed
 * section is a full card (icon chip + title + count + chevron) so it reads as a
 * deliberate control, not a stray label. PlacesGroup is a small controlled
 * client component (opens on the FIRST tap — a native <details> needs two on
 * iOS); this page stays a Server Component.
 */
export default function LocalPlacesPage() {
  const golf = PLACES.filter((p) => p.group === "golf");
  const food = PLACES.filter((p) => p.group === "food");
  const coffee = PLACES.filter((p) => p.group === "coffee");

  return (
    <div className="space-y-4 pt-2">
      <BackLink href="/" label="Home" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">📍 Local Places</h1>
        <p className="text-sm text-foreground/60">
          Book a tee time, order pizza, and more — favorite spots a short drive
          from the lake. Tap a section to open it.
        </p>
      </header>

      <div className="space-y-3">
        <PlacesGroup title="Golf" emoji="⛳" accent="primary" count={golf.length}>
          {golf.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </PlacesGroup>

        <PlacesGroup title="Food & Drink" emoji="🍔" accent="campfire" count={food.length}>
          {food.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </PlacesGroup>

        <PlacesGroup title="Coffee & Cafés" emoji="☕" accent="dusk" count={coffee.length}>
          {coffee.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </PlacesGroup>
      </div>

      <p className="text-center text-xs text-faint">
        More local favorites coming over time. Hours and details are set by each
        business.
      </p>
    </div>
  );
}

// The collapsible group card lives in components/PlacesGroup.tsx (a controlled
// client component — a native <details>/<summary> needs two taps to open on iOS,
// so a real button that toggles state is used instead).
