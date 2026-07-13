"use client";

import { FAMILY_FEST } from "@/lib/data";
import { useFestSeason } from "@/lib/useFestSeason";
import { CallTextButtons } from "@/components/CallTextButtons";
import { Protected } from "@/components/Guard";

const BETH_VENMO = "Beth-Birkholz-1";
const BETH_PHONE = "8472872608";
const BETH_EMAIL = "bethbirkholz@hotmail.com";
/** How long the reminder lingers after Family Fest ends, in days. */
const TAIL_DAYS = 7;

/**
 * MJT House's own Family Fest food/household dues — separate from the
 * resort-wide Family Fest dues (see FestDuesCalculator/PayView), collected
 * by Beth Birkholz ("Mops") for just this house. Only ever shown on the MJT
 * House hub, and only from now through a week after Family Fest ends.
 */
export function MjtHouseDuesCard({ slug }: { slug: string }) {
  const season = useFestSeason(FAMILY_FEST.startDate, FAMILY_FEST.endDate);
  if (slug !== "mjt-house") return null;
  if (!season || season.daysSinceEnd > TAIL_DAYS) return null;

  const venmoUrl = `https://venmo.com/${encodeURIComponent(BETH_VENMO)}?${new URLSearchParams({ txn: "pay" })}`;

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

      <a
        href={venmoUrl}
        target="_blank"
        rel="noreferrer"
        className="press flex items-center justify-center gap-2 rounded-xl bg-venmo py-2.5 text-sm font-semibold text-white"
      >
        Pay @{BETH_VENMO} with Venmo
      </a>
      <p className="text-center text-xs text-foreground/50">Or in cash the day you arrive.</p>

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
