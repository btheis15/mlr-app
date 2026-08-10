"use client";

import { useState } from "react";
import { ModalPortal } from "@/components/ModalPortal";

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
 *
 * ⚠️⚠️ TWO THINGS HERE ARE NOT STYLE CHOICES — the first version got both wrong and
 * shipped a checkmark that could not be tapped open:
 *
 * 1. THE EXPLAINER MUST BE PORTALED. Badges render inside a row's name line, which
 *    is `truncate` (→ `overflow: hidden`) so long names ellipsize. An absolutely
 *    positioned tooltip inside that span is CLIPPED TO INVISIBILITY — it opened
 *    correctly and simply could not be seen. Portaling also avoids the documented
 *    iOS trap: a bare `fixed inset-0` inside route content is confined by
 *    `.page-enter`'s transform and lands under the TabBar (see ModalPortal's own
 *    header, and the Conventions section of CLAUDE.md).
 *
 * 2. THE TRIGGER IS NOT A <button>. These badges sit inside rows that are
 *    themselves `<button>`s (tap to open the member sheet), and a button nested in
 *    a button is invalid HTML with genuinely unpredictable tap behavior on iOS.
 *    A span with `role="button"` is interactive and accessible without nesting.
 */
export function VerifiedBadge({
  verified,
  name,
  className = "",
}: {
  /** `profiles.approved`. `undefined`/`null` (pre-migration) renders nothing. */
  verified?: boolean | null;
  /** Optional: whose badge this is, so the explainer can name them. */
  name?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (verified !== true) return null;

  // Stop the tap reaching the enclosing row button (which would open the member
  // sheet instead of explaining the checkmark).
  const swallow = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-label="What does the checkmark mean?"
        onClick={(e) => {
          swallow(e);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            swallow(e);
            setOpen(true);
          }
        }}
        className={`press inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold leading-none text-primary ${className}`}
      >
        ✓
      </span>

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
            onClick={(e) => {
              swallow(e);
              setOpen(false);
            }}
          >
            <div
              className="pop-panel w-full max-w-sm space-y-2 rounded-2xl bg-card p-4 text-left ring-1 ring-border"
              onClick={swallow}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                  ✓
                </span>
                <p className="text-sm font-bold">Verified family member</p>
              </div>
              <p className="text-sm leading-snug text-foreground/70">
                An admin confirmed that {name?.trim() ? name.trim() : "this person"} is part of the family, so they can
                see photos, posts and contact details.
              </p>
              <p className="text-xs leading-snug text-muted">
                Anyone can sign up with any email address, so this is a second check by a real person — not just an
                email confirmation.
              </p>
              <button
                type="button"
                onClick={(e) => {
                  swallow(e);
                  setOpen(false);
                }}
                className="press mt-1 w-full rounded-xl bg-background py-2.5 text-sm font-semibold ring-1 ring-border"
              >
                Got it
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
