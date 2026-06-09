"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Shown once per device, the first time someone lands on Home. It orients a
// non-technical first-timer to the two things that aren't obvious: (1) you can
// browse everything without signing in, and (2) signing in is just name + email,
// no password. Dismissing it (or visiting Help) sets the flag so it never nags
// again.
const SEEN_KEY = "mlr-welcomed";

export function WelcomeCard() {
  // null until mounted so the prerendered HTML never flashes the card for
  // returning visitors who've already dismissed it.
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(SEEN_KEY) !== "1");
    } catch {
      setShow(false);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — it'll just show again next visit, no harm */
    }
  };

  if (!show) return null;

  return (
    <section className="rise space-y-3 rounded-2xl bg-primary/5 p-5 text-center ring-1 ring-primary/15">
      <span className="text-3xl" aria-hidden>
        👋
      </span>
      <h2 className="text-lg font-bold">Welcome to Muskellunge Lake Resort</h2>
      <p className="text-sm leading-relaxed text-foreground/75">
        Look around as much as you like — the schedule, photos, dining, events,
        and Family Fest are all open to browse. When you want to post, RSVP, or
        get alerts, just add your name and email (<b>no password</b> — we email
        you a quick code).
      </p>
      <p className="text-xs text-foreground/60">
        Tap along the bottom to explore: <b>Home</b>, <b>Feed</b>,{" "}
        <b>Family Fest</b>, <b>Activity</b>, and <b>Profile</b>.
      </p>
      <div className="flex flex-col gap-2 pt-1 sm:flex-row">
        <button
          type="button"
          onClick={dismiss}
          className="press flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
        >
          Got it
        </button>
        <Link
          href="/help"
          onClick={dismiss}
          className="press flex-1 rounded-xl bg-card py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/20"
        >
          New here? See how it works
        </Link>
      </div>
    </section>
  );
}
