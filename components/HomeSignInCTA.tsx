"use client";

import { useGuest } from "@/components/Guard";

/**
 * Front-page sign-in prompt for visitors who aren't signed in — so they can
 * join from Home without hunting through the Profile tab. Renders nothing once
 * signed in (and when there's no backend to sign in to).
 */
export function HomeSignInCTA() {
  const { guest, promptSignIn } = useGuest();
  if (!guest) return null;
  return (
    <section className="space-y-2 rounded-2xl bg-primary/5 p-4 text-center ring-1 ring-primary/20">
      <p className="text-sm font-semibold text-primary">🌲 Welcome — are you part of the resort?</p>
      <p className="text-xs text-foreground/60">
        Sign in to post, RSVP, join committees &amp; their chats, and get alerts. Looking around stays open to everyone.
      </p>
      <button
        onClick={promptSignIn}
        className="press w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
      >
        Sign in / Join
      </button>
    </section>
  );
}
