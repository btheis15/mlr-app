import Link from "next/link";

/**
 * iOS-style back affordance: a tinted "‹ Label" at the top-left of a drill-in
 * screen. Always names where it goes ("‹ All dinners"), so you know exactly
 * where you'll land — and you're never stranded on a detail page. Pair it with
 * the bottom tab bar (always one tap home) and the section sub-nav.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="press -ml-1 inline-flex items-center gap-0.5 py-1 text-sm font-semibold text-primary"
    >
      <span aria-hidden className="text-lg leading-none">
        ‹
      </span>
      {label}
    </Link>
  );
}
