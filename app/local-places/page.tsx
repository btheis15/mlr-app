import { BackLink } from "@/components/BackLink";
import { LocalPlaceCard } from "@/components/LocalPlaceCard";
import { PLACES } from "@/lib/places";

export const metadata = {
  title: "Local Places — Muskellunge Lake Resort",
};

/**
 * Local Places — the resort's favorite nearby spots: tee times at Inshalla
 * (handed off to our in-app /tee-times screen) plus the bars & grills we order
 * from. Each spot links straight to its menu, online ordering, phone, and site.
 * Data + ordering live in lib/places.ts; this page just groups and renders.
 */
export default function LocalPlacesPage() {
  const golf = PLACES.filter((p) => p.group === "golf");
  const food = PLACES.filter((p) => p.group === "food");

  return (
    <div className="space-y-6 pt-2">
      <BackLink href="/" label="Home" />

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">📍 Local Places</h1>
        <p className="text-sm text-foreground/60">
          Book a tee time, order pizza, and more — favorite spots a short drive
          from the lake.
        </p>
      </header>

      {golf.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Golf</SectionLabel>
          {golf.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </section>
      )}

      {food.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Food &amp; Drink</SectionLabel>
          {food.map((place, i) => (
            <div
              key={place.slug}
              className="rise"
              style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
            >
              <LocalPlaceCard place={place} />
            </div>
          ))}
        </section>
      )}

      <p className="text-center text-[11px] text-foreground/40">
        More local favorites coming over time. Hours and details are set by each
        business.
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">
      {children}
    </h2>
  );
}
