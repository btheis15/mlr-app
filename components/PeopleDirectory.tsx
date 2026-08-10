"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useCachedResource } from "@/lib/swrCache";
import { useIdentity } from "@/components/IdentityProvider";
import { Avatar } from "@/components/Avatar";
import { MemberSheet } from "@/components/MemberSheet";
import { SkeletonList } from "@/components/Skeleton";
import { SignInWall } from "@/components/Guard";
import { firstName } from "@/lib/privacy";
import { plural } from "@/lib/format";
import { payActions, type Action, type MemberContact } from "@/lib/contact";
import { isApple } from "@/lib/push";
import { isReviewerAccount } from "@/lib/reviewer";
import { VerifiedBadge } from "@/components/VerifiedBadge";

// One member as the directory needs them: identity for the row + the contact/pay
// fields we turn into the quick-action bar. These are the same private columns
// the MemberSheet reads, gated to members by RLS.
interface Person extends MemberContact {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** `profiles.approved` — drives the discrete verified checkmark. Optional so a
   *  pre-migration project (or a read that omits it) simply shows no badge. */
  approved?: boolean | null;
}

const tel = (s: string) => s.replace(/[^\d+]/g, "");

// Stale-while-revalidate cache for the member directory. PeopleDirectory remounts
// on every open of the People screen; without this it resets to empty + `loading`,
// so "Loading people…" flashes before the list paints back in. Holding the last
/**
 * People — the member directory. Every account, sorted by first name, with a
 * search box on top and a quick-action bar on each row (Text, Call, and their
 * preferred way to get paid). Tap a name/photo to open the full profile sheet
 * (the same MemberSheet used everywhere else). Members only — contact and pay
 * details are gated behind the sign-in wall.
 */
export function PeopleDirectory() {
  const { userId } = useIdentity();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<{ id: string; name: string; avatar?: string | null } | null>(null);

  // Shared SWR cache (`people.<uid>`, persisted): the directory paints
  // instantly on a return visit or cold open, then revalidates. uid-scoped so
  // a signed-out device never seeds it (the screen is behind SignInWall
  // anyway); like every persisted snapshot it's wiped on signOut. A transient
  // fetch error THROWS so the stale list stays up — we never poison the cache
  // with an empty array that a later remount would paint from.
  const { data: people, loading } = useCachedResource<Person[]>(
    userId ? `people.${userId}` : null,
    [],
    async () => {
      const sb = supabase;
      if (!sb) return [];
      const { data, error: e } = await sb
        .from("profiles")
        .select(
          "id, display_name, avatar_url, phone, contact_email, venmo, zelle, cashapp, paypal, pay_preferred, contact_preferred, apple_cash, approved",
        );
      if (e) {
        setError("Couldn't load people.");
        throw new Error(e.message);
      }
      setError(null);
      // Hide the Apple App Review demo account from the family-facing directory
      // (and, since the count derives from this list, from the member count too).
      // It stays fully functional and visible in admin tools.
      return ((data ?? []) as Person[]).filter((p) => !isReviewerAccount(p));
    },
    { persist: "local" },
  );

  // Sort by first name (then full name as a tiebreaker), then filter by the
  // search box. Names are matched whole so "smith" finds "Cathy Smith" too.
  const shown = useMemo(() => {
    const sorted = [...people].sort((a, b) => {
      const an = (a.display_name || "").trim();
      const bn = (b.display_name || "").trim();
      const cmp = firstName(an).localeCompare(firstName(bn), undefined, { sensitivity: "base" });
      return cmp !== 0 ? cmp : an.localeCompare(bn, undefined, { sensitivity: "base" });
    });
    const q = query.trim().toLowerCase();
    return q
      ? sorted.filter((p) => (p.display_name || "").toLowerCase().includes(q))
      : sorted;
  }, [people, query]);

  return (
    <SignInWall
      title="People"
      note="Sign in to see everyone in the resort and how to reach or pay them."
    >
      <div className="space-y-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people…"
          className="w-full rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />

        {loading ? (
          <SkeletonList />
        ) : error ? (
          <p className="py-6 text-center text-xs text-accent">{error}</p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-faint">
            {query.trim() ? "No one matches that." : "Nobody here yet — the resort's just getting started 🌲"}
          </p>
        ) : (
          <>
            <p className="px-0.5 text-xs text-faint">
              {people.length} {plural(people.length, "member")}
            </p>
            <ul className="space-y-1.5">
              {shown.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  onOpen={() =>
                    setSheet({
                      id: p.id,
                      name: p.display_name?.trim() || "Member",
                      avatar: p.avatar_url,
                    })
                  }
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {sheet && (
        <MemberSheet
          key={sheet.id}
          id={sheet.id}
          name={sheet.name}
          avatarUrl={sheet.avatar}
          onClose={() => setSheet(null)}
        />
      )}
    </SignInWall>
  );
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: () => void }) {
  const name = person.display_name?.trim() || "Member";
  // Apple Cash only works Apple↔Apple — hide it from non-Apple viewers, exactly
  // like the MemberSheet does. payActions floats their preferred method first.
  const pay = payActions(person).filter((a) => a.key !== "applecash" || isApple())[0];

  return (
    <li className="rounded-2xl bg-card p-3 ring-1 ring-border">
      <button type="button" onClick={onOpen} className="press flex w-full items-center gap-3 text-left">
        <Avatar name={name} url={person.avatar_url} size={40} />
        <span className="flex min-w-0 flex-1 items-center truncate text-sm font-semibold">
          <span className="truncate">{name}</span>
          <VerifiedBadge verified={person.approved} className="ml-1" />
        </span>
        <span aria-hidden className="shrink-0 text-base leading-none text-faint">›</span>
      </button>

      {/* Horizontal quick-action bar: Text, Call, and their pay preference. */}
      <div className="mt-2.5 flex items-center gap-2">
        {person.phone ? (
          <>
            <QuickLink href={`sms:${tel(person.phone)}`} emoji="💬" label="Text" />
            <QuickLink href={`tel:${tel(person.phone)}`} emoji="📞" label="Call" />
          </>
        ) : (
          <span className="text-xs text-foreground/35">No phone shared</span>
        )}
        {pay && <PayLink action={pay} onOpen={onOpen} />}
      </div>
    </li>
  );
}

// A plain contact pill (Text / Call) — neutral chip, tappable as a link.
function QuickLink({ href, emoji, label }: { href: string; emoji: string; label: string }) {
  return (
    <a
      href={href}
      className="press inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-foreground ring-1 ring-border active:bg-card"
    >
      <span className="text-sm leading-none">{emoji}</span>
      {label}
    </a>
  );
}

// The pay-preference pill — brand-colored to match the method. If it has a
// direct link (Venmo, Cash App, PayPal) it opens that; Zelle/Apple Cash have no
// universal deep link, so it opens the full profile where the handle is shown.
function PayLink({ action, onOpen }: { action: Action; onOpen: () => void }) {
  const inner = (
    <>
      {action.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={action.logo} alt="" className="h-3.5 w-3.5 shrink-0" />
      ) : null}
      {action.label}
    </>
  );
  const cls =
    "press ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-sm active:opacity-90";
  return action.href ? (
    <a
      href={action.href}
      target={action.href.startsWith("http") ? "_blank" : undefined}
      rel="noreferrer"
      className={cls}
      style={{ backgroundColor: action.brand }}
    >
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onOpen} className={cls} style={{ backgroundColor: action.brand }}>
      {inner}
    </button>
  );
}
