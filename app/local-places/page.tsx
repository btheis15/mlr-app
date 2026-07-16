import { BackLink } from "@/components/BackLink";
import { LocalPlaceCard } from "@/components/LocalPlaceCard";
import { PLACES, type PlaceAccent } from "@/lib/places";

export const metadata = {
  title: "Local Places — Muskellunge Lake Resort",
};

/**
 * Local Places — the resort's favorite nearby spots: tee times at Inshalla
 * (handed off to our in-app /tee-times screen) plus the bars & grills we order
 * from. Each spot links straight to its menu, online ordering, phone, and site.
 * Data + ordering live in lib/places.ts; this page just groups and renders.
 *
 * The three groups are collapsible <details> sections, all collapsed by default
 * so the page opens compact instead of a long wall of cards. Each collapsed
 * section is a full card (icon chip + title + count + chevron) so it reads as a
 * deliberate control, not a stray label. Native <details>/<summary> keeps this a
 * Server Component (no client JS) and stays static-export safe.
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
        <CollapsibleSection title="Golf" emoji="⛳" accent="primary" count={golf.length}>
          {golf.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Food & Drink" emoji="🍔" accent="campfire" count={food.length}>
          {food.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Coffee & Cafés" emoji="☕" accent="dusk" count={coffee.length}>
          {coffee.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </CollapsibleSection>
      </div>

      <p className="text-center text-xs text-faint">
        More local favorites coming over time. Hours and details are set by each
        business.
      </p>
    </div>
  );
}

// Literal class strings (not interpolated) so Tailwind's scanner emits them.
const CHIP: Record<PlaceAccent, string> = {
  primary: "bg-primary/12 text-primary",
  lake: "bg-lake/12 text-lake",
  campfire: "bg-campfire/12 text-campfire",
  sun: "bg-sun/12 text-sun",
  dusk: "bg-dusk/12 text-dusk",
};

/**
 * A collapsible group of place cards. The <summary> is a full card — an
 * accent-tinted icon chip, the group title, a "N places" count, and a chevron
 * that rotates open via `group-open:`. Native <details> starts closed (no `open`
 * attr). Renders nothing when the group is empty.
 */
function CollapsibleSection({
  title,
  emoji,
  accent,
  count,
  children,
}: {
  title: string;
  emoji: string;
  accent: PlaceAccent;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="group">
      <summary className="press flex cursor-pointer list-none select-none items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm [&::-webkit-details-marker]:hidden">
        <span
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${CHIP[accent]}`}
          aria-hidden
        >
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {count} {count === 1 ? "place" : "places"}
          </p>
        </div>
        <Chevron />
      </summary>
      <div className="mt-2 space-y-2">
        {Array.isArray(children)
          ? children.map((child, i) => (
              <div
                key={i}
                className="rise"
                style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
              >
                {child}
              </div>
            ))
          : children}
      </div>
    </details>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-5 w-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-90"
      aria-hidden
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
