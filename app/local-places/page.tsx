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
 *
 * The three groups are collapsible <details> sections, all collapsed by default
 * so the page opens compact instead of a long wall of cards. Native
 * <details>/<summary> keeps this a Server Component (no client JS) and stays
 * static-export safe.
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
        <CollapsibleSection title="Golf" count={golf.length}>
          {golf.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Food & Drink" count={food.length}>
          {food.map((place) => (
            <LocalPlaceCard key={place.slug} place={place} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Coffee & Cafés" count={coffee.length}>
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

/**
 * A collapsible group of place cards. Native <details> (starts closed — no
 * `open` attr), a styled <summary> header with the group's title + count and a
 * chevron that rotates open via `group-open:`. Renders nothing when the group
 * is empty, so a group with no places never shows a stray header.
 */
function CollapsibleSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="group">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-0.5 py-1 [&::-webkit-details-marker]:hidden">
        <Chevron />
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
          {title}
        </h2>
        <span className="text-xs font-semibold text-faint tabular-nums">{count}</span>
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
      className="h-4 w-4 shrink-0 text-faint transition-transform duration-200 group-open:rotate-90"
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
