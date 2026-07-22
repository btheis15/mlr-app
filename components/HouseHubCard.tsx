"use client";

import Link from "next/link";
import { useIdentity } from "@/components/IdentityProvider";
import { fetchMyHouse } from "@/lib/houses";
import { useCachedResource } from "@/lib/swrCache";
import { Icon } from "@/components/Icon";
import { haptic } from "@/lib/haptics";
import type { House } from "@/lib/types";

/**
 * Home card that opens the House Hub — the one place for a member's house
 * (calendar, chat, to-do list). Self-hides for guests and members not in a house,
 * so it only appears for the people it's for. Sits high on Home since many people
 * are focused on their house for most of the year.
 *
 * "My house" rides the shared SWR cache (lib/swrCache): memory covers the
 * tab-switch remounts, and the persisted `myHouse.<uid>` snapshot means a COLD
 * app open paints the card on the first client tick too — no more absent-then-
 * pop-in jumping the layout. The fetch still always revalidates, so a revoke
 * (removed from the house) overwrites the snapshot and hides the card. Admin
 * previews use a preview-scoped, memory-only key (never persisted).
 */
export function HouseHubCard() {
  const { user, userId, previewAsId } = useIdentity();
  const key =
    user && userId
      ? previewAsId
        ? `myHouse.preview.${previewAsId}`
        : `myHouse.${userId}`
      : null;
  const { data: house } = useCachedResource<House | null>(
    key,
    null,
    () => fetchMyHouse(previewAsId ?? userId),
    { persist: previewAsId ? undefined : "local" },
  );

  if (!house) return null;

  return (
    // One card, two tunnels: the body opens the House Hub (calendar + to-do +
    // chat), and the Chat button jumps STRAIGHT into the house chat room
    // (/posts?house=<slug> — FeedView's deep-link opens it directly, no stop at
    // the chats list). Two sibling Links (a Link can't nest inside a Link).
    <div className="flex items-center gap-2 rounded-2xl bg-primary p-3 pl-4 text-white shadow-sm">
      <Link href="/house" className="press flex min-w-0 flex-1 items-center gap-3 py-1">
        <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl">
          {house.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{house.name}</p>
          <p className="mt-0.5 text-xs text-white/80">Your house — calendar &amp; to-do list</p>
        </div>
      </Link>
      <Link
        href={`/posts?house=${house.slug}`}
        onClick={() => haptic("light")}
        aria-label={`Open ${house.name} chat`}
        className="press flex w-[4.25rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-white/15 py-2 text-[11px] font-semibold"
      >
        <Icon name="feed" size={20} strokeWidth={2} />
        Chat
      </Link>
    </div>
  );
}
