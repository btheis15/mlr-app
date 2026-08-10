"use client";

import { useState } from "react";

/**
 * A discrete "verified" checkmark next to a member's name — the Twitter/X
 * treatment: small enough to ignore, tappable when someone wonders what it means.
 *
 * "Verified" here means an app admin confirmed this person is family. It is NOT
 * email verification (Supabase already does that on sign-in) — anyone can confirm
 * an email address, which is exactly why this second check exists.
 *
 * Deliberately renders NOTHING for an unverified person on family-facing surfaces.
 * An "unverified" label next to a relative's name in the People directory would be
 * a quiet accusation, and it isn't information a member can act on anyway. Admins
 * get the explicit, actionable version in Admin → Members instead.
 */
export function VerifiedBadge({
  verified,
  className = "",
}: {
  /** `profiles.approved`. `undefined`/`null` (pre-migration) renders nothing. */
  verified?: boolean | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (verified !== true) return null;

  return (
    <span className={`relative inline-flex shrink-0 items-center ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          // These badges sit inside rows that are themselves buttons (open the
          // member sheet). Without this, tapping the checkmark would navigate
          // instead of explaining itself.
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="What does the checkmark mean?"
        className="press inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold leading-none text-primary"
      >
        ✓
      </button>
      {open && (
        <>
          {/* Tap anywhere to dismiss. Fixed + inset-0 rather than a document
              listener so it can't leak past unmount. */}
          <span className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <span
            role="tooltip"
            className="absolute left-1/2 top-full z-50 mt-1.5 w-52 -translate-x-1/2 rounded-xl bg-card p-2.5 text-left text-[11px] leading-snug text-foreground/80 shadow-lg ring-1 ring-border"
          >
            <span className="block font-semibold text-foreground">Verified family member</span>
            An admin confirmed this person is part of the family, so they can see
            photos, posts and contact details.
          </span>
        </>
      )}
    </span>
  );
}
