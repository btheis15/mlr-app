"use client";

import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";

/**
 * The persistent top app chrome — your profile photo in the top-left corner
 * (Facebook/X style; a generic "blank profile" icon until you add a photo) and
 * the MLR cabin logo centered. Tapping the photo opens Profile; tapping the
 * logo goes Home. The right-side spacer matches the avatar width so the logo
 * stays optically centered. Lives above the announcement banner + page content
 * (and above the Family Fest section's parchment theme — it's the resort
 * chrome), so it shows on every screen.
 *
 * The logo is a responsive hero — its height auto-fits the viewport (see
 * `#app-logo` in app/globals.css) so Home's "Get involved" card lands as the
 * last fully-visible thing above the tab bar on any iPhone. Because the logo
 * can be much taller than the avatar, the row is top-aligned (`items-start`) to
 * keep the profile photo pinned in the top-left corner as the logo grows.
 */
export function AppHeader() {
  const { user } = useIdentity();
  return (
    <header className="flex items-start justify-between gap-2 pb-1 pt-1">
      <Link
        href="/profile"
        aria-label="Your profile"
        className="press shrink-0 rounded-full"
      >
        <Avatar name={user?.name ?? ""} url={user?.avatarUrl} size={40} fallback="icon" />
      </Link>

      <Link href="/" aria-label="Muskellunge Lake Resort — Home" className="press min-w-0">
        {/* The green cabin-in-the-pines brand logo (same mark as the opening
            splash), not the stylized wordmark. Its height is set responsively
            in app/globals.css (#app-logo) to fill the top as the app's hero;
            `w-auto max-w-full` keeps the aspect ratio and prevents overflow on
            narrow screens. Tagged `app-logo` so the SplashIntro can measure
            this exact spot and fly the splash logo into it for a seamless
            hand-off. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          id="app-logo"
          src="/brand-logo-green.png"
          alt="Muskellunge Lake Resort"
          className="block w-auto max-w-full"
        />
      </Link>

      {/* Spacer to balance the avatar so the logo stays centered. */}
      <span aria-hidden className="h-10 w-10 shrink-0" />
    </header>
  );
}
