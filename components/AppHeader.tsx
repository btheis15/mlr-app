"use client";

import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";

/**
 * The persistent top app chrome — your profile photo in the top-left corner
 * (Facebook/X style; a generic "blank profile" icon until you add a photo) and
 * the MLR wordmark centered. Tapping the photo opens Profile; tapping the
 * wordmark goes Home. The right-side spacer matches the avatar width so the
 * logo stays optically centered. Lives above the announcement banner + page
 * content (and above the Family Fest section's parchment theme — it's the
 * resort chrome), so it shows on every screen.
 */
export function AppHeader() {
  const { user } = useIdentity();
  return (
    <header className="flex items-center justify-between gap-2 pb-1 pt-1">
      <Link
        href="/profile"
        aria-label="Your profile"
        className="press shrink-0 rounded-full"
      >
        <Avatar name={user?.name ?? ""} url={user?.avatarUrl} size={36} fallback="icon" />
      </Link>

      <Link href="/" aria-label="Muskellunge Lake Resort — Home" className="press min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/wordmark.svg"
          alt="Muskellunge Lake Resort"
          className="block h-9 w-auto max-w-full"
        />
      </Link>

      {/* Spacer to balance the avatar so the wordmark centers. */}
      <span aria-hidden className="h-9 w-9 shrink-0" />
    </header>
  );
}
