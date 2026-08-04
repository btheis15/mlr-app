"use client";

import { useEffect, useState } from "react";
import { CommitteeChat } from "@/components/CommitteeChat";
import { COMMITTEES } from "@/lib/data";
import { fetchCommitteeBySlug } from "@/lib/committeeAdmin";
import { useUrlParam } from "@/lib/hooks";

/**
 * The channel this route opens, from `?area=`.
 *
 * ⚠️ Read in an EFFECT, never in a `useState` initializer. This route is
 * statically prerendered, so the server HTML is always the General channel;
 * reading the query string during the initializer makes the first CLIENT
 * render disagree with that HTML, and React resolves the hydration mismatch by
 * throwing the tree away — which left every link on the screen inert (an
 * un-hydrated page has no event handlers at all). That cost the whole page to
 * save one frame.
 *
 * Deferring by a tick costs nothing visible here: `CommitteeChat` shows its
 * neutral spinner until access resolves over the network anyway, which lands
 * long after this effect, so `area` is already correct by the time any message
 * query runs. `useUrlParam` is the shared helper for exactly this and also
 * keeps up with in-place URL changes.
 */
function useAreaParam(): string | null {
  const raw = useUrlParam("area");
  return raw && raw.trim() ? raw : null;
}

/**
 * The standalone committee-chat route (`/committees/<slug>/chat`, opened from
 * the committee page's chat tiles). DB-driven name/emoji (migration 0112) with
 * the in-code seed as the first-paint / offline fallback, so a committee an
 * admin created opens correctly. CommitteeChat resolves membership + messages
 * itself from the slug.
 *
 * `?area=<role>` opens that role's sub-channel (including the reserved `Leads`
 * room, migration 0172) instead of General. This route used to be
 * General-only, which is why the committee page's Leads tile had to deep-link
 * through `/posts?c=&area=Leads` — landing on the Feed's all-chats list first
 * and then jumping into the room, a visible flash and a wrong Back target.
 * Now it's one direct navigation, exactly like the General chat tile.
 */
export function CommitteeChatRoute({ slug, area: fixedArea }: { slug: string; area?: string | null }) {
  // A route may pin the channel (`/committees/<slug>/leads`), which is the
  // preferred form — see that route's note on installed-PWA navigation. The
  // `?area=` read stays as a fallback so existing links keep working.
  const paramArea = useAreaParam();
  const area = fixedArea ?? paramArea;
  const seed = COMMITTEES.find((c) => c.slug === slug);
  const [meta, setMeta] = useState<{ name: string; emoji: string }>(
    { name: seed?.name ?? "Committee", emoji: seed?.emoji ?? "🌲" },
  );
  useEffect(() => {
    let alive = true;
    fetchCommitteeBySlug(slug).then((c) => {
      if (alive && c) setMeta({ name: c.name, emoji: c.emoji });
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  // The header shows which channel you're in, so a Leads/role room doesn't look
  // identical to the committee's General chat.
  const name = area ? `${meta.name} · ${area}` : meta.name;
  // Keyed on the channel so CommitteeChat REMOUNTS when `area` lands from the
  // effect above. Its message-load effect depends on [isMember, committeeId] —
  // not on `area` — so without this a fast access resolve could load General's
  // messages and then never refetch for the real channel.
  return <CommitteeChat key={area ?? ""} slug={slug} name={name} emoji={meta.emoji} area={area} />;
}
