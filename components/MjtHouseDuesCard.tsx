"use client";

import { useState } from "react";
import Link from "next/link";
import { FAMILY_FEST } from "@/lib/data";
import { useFestSeason } from "@/lib/useFestSeason";
import { CallTextButtons } from "@/components/CallTextButtons";
import { Protected } from "@/components/Guard";
import { supabase } from "@/lib/supabase";
import { useIdentity } from "@/components/IdentityProvider";
import { useCachedResource } from "@/lib/swrCache";

const BETH_PHONE = "8472872608";
const BETH_EMAIL = "bethbirkholz@hotmail.com";
/** How long the reminder lingers after Family Fest ends, in days. */
const TAIL_DAYS = 7;
const FEST_YEAR = Number(FAMILY_FEST.startDate.slice(0, 4));

/**
 * MJT House's own Family Fest food/household dues — separate from the
 * resort-wide Family Fest dues (see FestDuesCalculator/PayView), collected
 * by Beth Birkholz ("Mops") for just this house. Only ever shown on the MJT
 * House hub, and only from now through a week after Family Fest ends. A
 * member can mark themself paid (profiles.mjt_dues_paid_year, migration 0086)
 * so it stops prompting them — it comes back next year since the stored
 * year won't match FEST_YEAR then.
 */
export function MjtHouseDuesCard({ slug }: { slug: string }) {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  const { userId } = useIdentity();
  const [busy, setBusy] = useState(false);

  // Cached paid state (null = still checking) — seeds the last-known value
  // instantly (memory across tab switches, persisted across cold opens) so the
  // "you're paid" card doesn't blink absent-then-present every time you land on
  // the House Hub. The fetch still revalidates behind the seed.
  const { data: paid, mutate } = useCachedResource<boolean | null>(
    slug === "mjt-house" && userId ? `mjtDues.${userId}.${FEST_YEAR}` : null,
    null,
    async () => {
      const sb = supabase;
      if (!sb || !userId) return false;
      const { data } = await sb.from("profiles").select("mjt_dues_paid_year").eq("id", userId).maybeSingle();
      return (data?.mjt_dues_paid_year as number | null) === FEST_YEAR;
    },
    { persist: "local" },
  );

  if (slug !== "mjt-house") return null;
  if (!season || season.daysSinceEnd > TAIL_DAYS) return null;
  if (paid === null) return null; // still checking — avoids a flash of the full pitch

  const setPaidYear = (year: number | null) =>
    (async () => {
      setBusy(true);
      const sb = supabase;
      if (sb && userId) {
        await sb.from("profiles").update({ mjt_dues_paid_year: year }).eq("id", userId);
        mutate(year === FEST_YEAR);
      }
      setBusy(false);
    })();

  if (paid) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <p className="text-sm text-foreground/70">
          <span className="mr-1" aria-hidden>✅</span>
          MJT House dues — you&rsquo;re marked as paid for {FEST_YEAR}.
        </p>
        <button
          type="button"
          onClick={() => setPaidYear(null)}
          disabled={busy}
          className="press shrink-0 text-xs font-medium text-foreground/50 underline underline-offset-2 disabled:opacity-50"
        >
          Undo
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div>
        <h2 className="text-sm font-bold">
          <span className="mr-1" aria-hidden>
            🍽️
          </span>
          MJT House dues
        </h2>
        <p className="mt-1.5 text-sm text-foreground/70">
          We&rsquo;re collecting $10/day/person ($2/day for kids 6&ndash;10; kids
          under 5 are free) for food &amp; household items for the MJT house
          &mdash; this doesn&rsquo;t include pop or alcohol.
        </p>
      </div>

      <p className="text-sm text-foreground/70">
        Please confirm and pay ASAP to Beth:
      </p>
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-foreground/70">
        <li>How many from your family will be attending</li>
        <li>What days you&rsquo;ll be there</li>
        <li>Who, if anyone, will be tenting</li>
      </ol>

      <Link
        href="/house/dues?house=mjt-house"
        className="press flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white"
      >
        🧮 Calculate &amp; pay
      </Link>
      <button
        type="button"
        onClick={() => setPaidYear(FEST_YEAR)}
        disabled={busy}
        className="press w-full text-center text-xs font-medium text-primary underline underline-offset-2 disabled:opacity-50"
      >
        ✅ I&rsquo;ve already paid
      </button>
      <p className="text-center text-xs text-foreground/50">Or pay in cash the day you arrive.</p>

      <div className="space-y-2">
        <CallTextButtons phone={BETH_PHONE} />
        <Protected label="Sign in to email Beth" className="mx-auto">
          <a
            href={`mailto:${BETH_EMAIL}`}
            className="press block rounded-xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary"
          >
            ✉️ Email Beth
          </a>
        </Protected>
      </div>
    </section>
  );
}
