import type { ReactNode } from "react";

/**
 * The app's hand-rolled inline-SVG icon set — lucide-style line icons (24×24
 * grid, stroked with `currentColor`, no fill, rounded caps/joins) written by
 * hand so there's no icon dependency or CDN fetch. Icons inherit the text
 * color of their parent (e.g. `text-primary`, `text-fest`, `text-lake`), so
 * tint them the same way you'd tint text. Decorative by default
 * (`aria-hidden`) — pair with visible text or an aria-label on the control.
 *
 * Add new icons here (keep paths simple — they render at 20–26px).
 */

export type IconName =
  | "home"
  | "feed"
  | "fest"
  | "bell"
  | "person"
  | "people"
  | "calendar"
  | "cabin"
  | "hand"
  | "pin"
  | "users"
  | "sparkle"
  | "gear"
  | "question";

const PATHS: Record<IconName, ReactNode> = {
  // A house: roof, walls, arched door.
  home: (
    <>
      <path d="M3 10.4 12 3l9 7.4" />
      <path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M9.5 21v-5.5a2.5 2.5 0 0 1 5 0V21" />
    </>
  ),
  // Two overlapping chat bubbles (the conversations list).
  feed: (
    <>
      <path d="M15 9.5a2 2 0 0 1-2 2H6.5L3 14.5V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18.5 8.5h.5a2 2 0 0 1 2 2V21l-3.5-3.5H11a2 2 0 0 1-2-2V15" />
    </>
  ),
  // Family Fest — an A-frame tent with open door flaps (not crossed swords).
  fest: (
    <>
      <path d="M12 3.5 2.5 20.5" />
      <path d="m12 3.5 9.5 17" />
      <path d="M2 20.5h20" />
      <path d="M8.2 20.5 12 13.5l3.8 7" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5.5 2 7 2 7H4s2-1.5 2-7" />
      <path d="M10.2 20a2 2 0 0 0 3.6 0" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="7.8" r="3.4" />
      <path d="M5.2 20.5c.9-3.6 3.6-5.6 6.8-5.6s5.9 2 6.8 5.6" />
    </>
  ),
  // Two people — one in front, one peeking behind.
  people: (
    <>
      <circle cx="9" cy="8" r="3.3" />
      <path d="M3.2 20.3c.7-3.3 2.9-5.2 5.8-5.2s5.1 1.9 5.8 5.2" />
      <path d="M15.4 4.9a3.3 3.3 0 0 1 0 6.2" />
      <path d="M17.6 15.4c1.8.8 3 2.5 3.4 4.9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.8" width="17" height="16.2" rx="2.4" />
      <path d="M3.5 9.6h17" />
      <path d="M8.2 2.8v4" />
      <path d="M15.8 2.8v4" />
    </>
  ),
  // A log cabin: same silhouette family as `home` but with a squared door and
  // a horizontal log line so the two stay distinguishable side by side.
  cabin: (
    <>
      <path d="M2.8 10.8 12 3.6l9.2 7.2" />
      <path d="M5 9.2V21h14V9.2" />
      <path d="M5 13.4h14" />
      <path d="M10 21v-4.6h4V21" />
    </>
  ),
  // An open, raised hand (lend a hand / helping).
  hand: (
    <>
      <path d="M17.8 11V6a1.8 1.8 0 0 0-3.6 0v5" />
      <path d="M14.2 10V4.3a1.8 1.8 0 0 0-3.6 0V10" />
      <path d="M10.6 10.5V6a1.8 1.8 0 0 0-3.6 0v8" />
      <path d="M17.8 8.2a1.8 1.8 0 1 1 3.6 0v5.6a7.2 7.2 0 0 1-7.2 7.2h-1.8c-2.5 0-4-.8-5.4-2.1l-3.2-3.3a1.8 1.8 0 0 1 2.5-2.5L7 14" />
    </>
  ),
  // Map pin.
  pin: (
    <>
      <path d="M12 21.5c4.7-4 7-7.7 7-11a7 7 0 0 0-14 0c0 3.3 2.3 7 7 11z" />
      <circle cx="12" cy="10.2" r="2.7" />
    </>
  ),
  // Two people side by side (committees / groups).
  users: (
    <>
      <circle cx="8.2" cy="7.8" r="3.1" />
      <path d="M2.6 20c.8-3.2 2.9-5 5.6-5s4.8 1.8 5.6 5" />
      <circle cx="16.8" cy="9.2" r="2.5" />
      <path d="M14.9 15.4c.6-.3 1.2-.4 1.9-.4 2.4 0 4.2 1.6 4.8 4.5" />
    </>
  ),
  // A four-point spark with a smaller companion.
  sparkle: (
    <>
      <path d="m12 4.5 1.7 4.6 4.6 1.7-4.6 1.7L12 17.1l-1.7-4.6-4.6-1.7 4.6-1.7z" />
      <path d="m18.6 15.7.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />
    </>
  ),
  // A cog: hub + ring + eight teeth.
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <circle cx="12" cy="12" r="6.6" />
      <path d="M12 2.6v2.8" />
      <path d="M12 18.6v2.8" />
      <path d="M2.6 12h2.8" />
      <path d="M18.6 12h2.8" />
      <path d="m5.4 5.4 2 2" />
      <path d="m16.6 16.6 2 2" />
      <path d="m18.6 5.4-2 2" />
      <path d="m7.4 16.6-2 2" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.1a2.9 2.9 0 0 1 5.6.9c0 1.9-2.8 2.4-2.8 3.6" />
      <path d="M12 17.2h.01" />
    </>
  ),
};

export function Icon({
  name,
  size = 24,
  strokeWidth = 1.8,
  className,
}: {
  name: IconName;
  size?: number;
  /** Bump (e.g. 2.4) for an active/bold state. */
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
