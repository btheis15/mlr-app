"use client";

import { BackLink } from "@/components/BackLink";
import { PayView } from "@/components/PayView";
import { SignInWall } from "@/components/Guard";
import { useFestContent } from "@/lib/useFestContent";

export default function PayPage() {
  const { dues, payees } = useFestContent({ realtime: true });

  return (
    <div className="space-y-3 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />

      <SignInWall
        title="Pay"
        note="Payment details (who to pay and how) are kept private. Add your name & email to see them."
      >
        {/* Dues tiers — admin-editable amounts (TBD until set in the Planner). */}
        <div className="rounded-2xl bg-primary/10 p-4">
          <p className="text-center text-xs font-semibold uppercase tracking-wide text-primary">
            Family Fest dues
          </p>
          <ul className="mt-3 space-y-2">
            {dues.map((tier) => (
              <li key={tier.id} className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-foreground/80">
                  {tier.label}
                  {tier.note && <span className="text-foreground/50"> · {tier.note}</span>}
                </span>
                <span className="shrink-0 text-base font-bold text-primary">
                  {tier.amount != null ? `$${tier.amount}` : "TBD"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <PayView payees={payees} />
      </SignInWall>
    </div>
  );
}
