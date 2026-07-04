"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchMyHouse } from "@/lib/houses";
import type { House } from "@/lib/types";

/**
 * Home card that opens the House Hub — the one place for a member's house
 * (calendar, chat, to-do list). Self-hides for guests and members not in a house,
 * so it only appears for the people it's for. Sits high on Home since many people
 * are focused on their house for most of the year.
 */
export function HouseHubCard() {
  const { user, previewAsId } = useIdentity();
  const [house, setHouse] = useState<House | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setHouse(null);
      return;
    }
    fetchMyHouse(previewAsId ?? undefined)
      .then((h) => {
        if (!cancelled) setHouse(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, previewAsId]);

  if (!house) return null;

  return (
    <Link
      href="/house"
      className="press flex items-center gap-3 rounded-2xl bg-primary p-4 text-white shadow-sm"
    >
      <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl">
        {house.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{house.name}</p>
        <p className="mt-0.5 text-xs text-white/80">Your house — calendar, chat &amp; to-do list</p>
      </div>
      <span className="shrink-0 text-lg leading-none text-white/70" aria-hidden>
        ›
      </span>
    </Link>
  );
}
