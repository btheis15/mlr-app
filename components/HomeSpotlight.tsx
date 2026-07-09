"use client";

import { useFestContent } from "@/lib/useFestContent";
import { FamilyFestSpotlight } from "@/components/FamilyFestSpotlight";
import { CalloutStack, type StackItem } from "@/components/CalloutStack";
import { useDemoDate } from "@/lib/DemoDateProvider";

// Order deadline: Wednesday July 15, 2026
const TSHIRT_DEADLINE = "2026-07-16"; // hide on/after this date (day after deadline)

function TShirtOrderCallout() {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            👕 Family Fest T-Shirts
          </p>
          <p className="mt-0.5 text-base font-semibold leading-snug">
            Order now — deadline Wed, July 15
          </p>
        </div>
        <span className="shrink-0 text-2xl">👕</span>
      </div>

      <div className="mt-2.5 space-y-1 text-sm text-foreground/80">
        <p>
          <span className="font-medium">Colors:</span> Maroon · Forest Green · Navy Blue
        </p>
        <p>
          <span className="font-medium">Pricing:</span> $14 (Youth XS–Adult XL) · $19 (5XL)
        </p>
        <p className="text-foreground/60 text-xs">FF sweatshirts available again as well.</p>
      </div>

      <a
        href="tel:7153653195"
        className="press mt-3 flex items-center justify-between rounded-xl bg-primary/10 px-3.5 py-2.5 text-sm font-semibold text-primary ring-1 ring-primary/20"
      >
        <span>📞 Call Tricia at Metro to order</span>
        <span className="font-normal text-primary/70">715-365-3195</span>
      </a>

      <p className="mt-2 text-[11px] text-foreground/45 text-center">
        Orders picked up shortly after July 15
      </p>
    </div>
  );
}

/**
 * The Home "what's happening" slot. The Family Fest spotlight is the permanent
 * base; temporary call-outs (future news/alerts) stack on top of it as
 * swipe-away cards (see CalloutStack). Stacking — rather than listing them down
 * the page — is deliberate: it keeps the slot to one card tall so the
 * Ask-for-Help row below stays in view no matter how many call-outs are active.
 *
 * Add a future call-out by pushing another swipeable StackItem ABOVE the base,
 * gated by whatever decides it should show. Give it a stable, versioned id so a
 * brand-new alert reappears even if a same-purpose card was swiped before.
 */
export function HomeSpotlight() {
  // Live fest content (schedule + meta) so the spotlight matches the Planner.
  const { config, schedule } = useFestContent({ realtime: true });
  const { today } = useDemoDate();

  const items: StackItem[] = [];

  // T-shirt order callout — visible until the July 15 deadline passes.
  if (today < TSHIRT_DEADLINE) {
    items.push({
      id: "tshirt-order-jul15-2026",
      swipeable: true,
      node: <TShirtOrderCallout />,
    });
  }

  // The permanent base — never swipeable, so something always sits here.
  items.push({
    id: "family-fest-spotlight",
    swipeable: false,
    node: (
      <FamilyFestSpotlight
        name={config.name}
        tagline={config.tagline}
        startDate={config.startDate}
        endDate={config.endDate}
        schedule={schedule}
      />
    ),
  });

  return <CalloutStack items={items} />;
}
