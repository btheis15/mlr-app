"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchMyHouse } from "@/lib/houses";
import type { House } from "@/lib/types";

/**
 * Stale-while-revalidate cache for "my house". This card remounts on every tab
 * navigation back to Home; without this it resets to `null` and self-hides for a
 * beat, so the card (and everything laid out below it) is absent then pops in,
 * jumping the page. Holding the last result in memory lets a returning Home paint
 * the card instantly from cache while a background refetch keeps it current, so
 * the layout stays put. Keyed by viewer identity + previewAs (both change the
 * resolved house), mirroring `useEvents`/`eventsCache`. Memory-only (per session)
 * and only ever written *after* a client fetch — never during SSR — so it can't
 * change the server/first-paint render and can't cause a hydration mismatch (a
 * cold load starts with an empty map + null user ⇒ null ⇒ hidden, i.e. the
 * original behavior). A revoke (removed from the house) is honored: the refetch
 * returns null, which overwrites the cache and hides the card.
 */
const myHouseCardCache = new Map<string, House | null>();

/**
 * Home card that opens the House Hub — the one place for a member's house
 * (calendar, chat, to-do list). Self-hides for guests and members not in a house,
 * so it only appears for the people it's for. Sits high on Home since many people
 * are focused on their house for most of the year.
 */
export function HouseHubCard() {
  const { user, previewAsId } = useIdentity();
  const key = `${user?.email ?? ""}|${previewAsId ?? "self"}`;
  // Warm cache ⇒ paint immediately (no self-hide flash); the effect below still
  // refetches so the cached view is brought up to date (incl. a revoke → null).
  const [house, setHouse] = useState<House | null>(
    myHouseCardCache.has(key) ? myHouseCardCache.get(key)! : null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setHouse(null);
      return;
    }
    fetchMyHouse(previewAsId ?? undefined)
      .then((h) => {
        if (!cancelled) setHouse(h);
        myHouseCardCache.set(key, h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, previewAsId, key]);

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
