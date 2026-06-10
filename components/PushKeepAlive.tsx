"use client";

import { useEffect } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { reconcilePush } from "@/lib/push";

/**
 * Invisible. Keeps THIS device's push subscription alive.
 *
 * Web push on an installed iOS PWA is fragile: iOS rotates or drops the push
 * token on its own (after an OS update, a Home-Screen icon re-add, or weeks
 * idle), and Apple keeps returning HTTP 201 for the now-dead token — so a
 * subscription saved once goes silently dead and every notification is
 * accepted-but-never-delivered. The Profile → Notifications toggle only
 * re-subscribes when you turn the FIRST category on, so a member who already has
 * categories ticked never gets re-registered just by visiting settings.
 *
 * This component closes that gap: whenever a signed-in member who wants push
 * opens the app — and again each time it returns from the background, the moment
 * iOS is most likely to have rotated the token — we silently re-register the
 * device (reconcilePush no-ops unless push is supported, permission is already
 * granted, and on iOS the app is installed, so it never prompts).
 */
export function PushKeepAlive() {
  const { user } = useIdentity();
  const wantsPush = (user?.pushTypes?.length ?? 0) > 0;

  useEffect(() => {
    if (!wantsPush) return;
    void reconcilePush();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcilePush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [wantsPush]);

  return null;
}
