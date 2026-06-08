import Link from "next/link";
import type { LocalPlace, PlaceAccent } from "@/lib/places";

/**
 * A Local Places card: an accent-tinted icon chip + name/category/blurb, then a
 * row of quick actions. Two shapes:
 *
 *  - In-app hand-off (`place.internalHref`, e.g. Inshalla → /tee-times): a
 *    prominent primary CTA that keeps the user in the app's booking flow, with
 *    any Call / Website pills shown beneath it.
 *  - External business: a cluster of equal icon+label pills — Menu, Order, Call,
 *    Website — showing only the ones that place actually has.
 *
 * Presentational + link-only (no state), so it stays a Server Component and ships
 * fine in the static export.
 */

// Literal class strings (not interpolated) so Tailwind's scanner emits them.
const ACCENT: Record<PlaceAccent, string> = {
  primary: "bg-primary/12 text-primary",
  lake: "bg-lake/12 text-lake",
  campfire: "bg-campfire/12 text-campfire",
  sun: "bg-sun/12 text-sun",
  dusk: "bg-dusk/12 text-dusk",
};

export function LocalPlaceCard({ place }: { place: LocalPlace }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${ACCENT[place.accent]}`}
          aria-hidden
        >
          {place.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight">{place.name}</h3>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-foreground/45">
            {place.category} · {place.locality}
          </p>
          <p className="mt-1 text-xs leading-snug text-foreground/70">{place.blurb}</p>
        </div>
      </div>

      <PlaceActions place={place} />
    </div>
  );
}

/**
 * One side-by-side row of equal icon+label pills, showing only the actions a
 * place has. For an in-app spot (Inshalla) the booking hand-off is the first
 * pill — filled green to read as the primary action — sitting alongside Call /
 * Website, exactly like Menu/Call/Website on the other cards.
 */
function PlaceActions({ place }: { place: LocalPlace }) {
  const hasAny = Boolean(
    place.internalHref ||
      place.menuUrl ||
      place.orderUrl ||
      place.phoneTel ||
      place.website,
  );
  if (!hasAny) return null;
  return (
    <div className="mt-3 flex gap-2">
      {place.internalHref && (
        <ActionPill
          href={place.internalHref}
          internal
          primary
          label={place.internalCta ?? "Open"}
          ariaLabel={`${place.internalCta ?? "Open"} at ${place.name}`}
          iconClass="text-white"
          icon={<FlagIcon />}
        />
      )}
      {place.menuUrl && (
        <ActionPill
          href={place.menuUrl}
          external
          label="Menu"
          ariaLabel={`${place.name} menu (opens in a new tab)`}
          iconClass="text-foreground/55"
          icon={<MenuIcon />}
        />
      )}
      {place.orderUrl && (
        <ActionPill
          href={place.orderUrl}
          external
          label="Order"
          ariaLabel={`Order online from ${place.name} (opens in a new tab)`}
          iconClass="text-campfire"
          icon={<BagIcon />}
        />
      )}
      {place.phoneTel && (
        <ActionPill
          href={`tel:${place.phoneTel}`}
          label="Call"
          ariaLabel={`Call ${place.name}${place.phoneDisplay ? ` at ${place.phoneDisplay}` : ""}`}
          iconClass="text-primary"
          icon={<PhoneIcon />}
        />
      )}
      {place.website && (
        <ActionPill
          href={place.website}
          external
          label="Website"
          ariaLabel={`${place.name} website (opens in a new tab)`}
          iconClass="text-lake"
          icon={<GlobeIcon />}
        />
      )}
    </div>
  );
}

function ActionPill({
  href,
  label,
  ariaLabel,
  icon,
  iconClass,
  external,
  internal,
  primary,
}: {
  href: string;
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
  iconClass: string;
  external?: boolean;
  /** Render an in-app Link (no new tab) instead of an external anchor. */
  internal?: boolean;
  /** Filled forest-green pill — the primary action (e.g. Book Tee Time). */
  primary?: boolean;
}) {
  const className = `press flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2.5 ${
    primary ? "bg-primary" : "bg-background ring-1 ring-border active:bg-card"
  }`;
  const inner = (
    <>
      <span className={primary ? "text-white" : iconClass}>{icon}</span>
      <span
        className={`text-center text-xs font-semibold leading-tight ${
          primary ? "text-white" : "text-foreground/70"
        }`}
      >
        {label}
      </span>
    </>
  );
  if (internal) {
    return (
      <Link href={href} aria-label={ariaLabel} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={className}
    >
      {inner}
    </a>
  );
}

// ── Icons: 24×24 line icons, matching the app's existing PhoneIcon style ──

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M6 21V3l11 3.5L6 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3c-2.5 2.5-2.5 15.5 0 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <rect x="5" y="3" width="14" height="18" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9 8h6M9 12h6M9 16h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 8a3 3 0 0 1 6 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
