"use client";

import { useState } from "react";
import { useResolvedHouse } from "@/lib/hooks";
import { FAMILY_FEST } from "@/lib/data";
import { BackLink } from "@/components/BackLink";
import { SkeletonList } from "@/components/Skeleton";
import { FestDuesCalculator } from "@/components/FestDuesCalculator";
import { PayView } from "@/components/PayView";
import type { DuesTier, Payee } from "@/lib/types";

const MJT_DUES: DuesTier[] = [
  { id: "adult", label: "Adult", amount: 10, perDay: true },
  { id: "kid-6-10", label: "Kid (6–10)", amount: 2, perDay: true },
  { id: "kid-under-6", label: "Kid (under 6)", amount: 0, perDay: true, note: "free" },
];

const MJT_PAYEE: Payee[] = [
  { id: "beth-birkholz", name: "Beth Birkholz", role: "MJT House dues", venmo: "Beth-Birkholz-1", note: "Or pay in cash the day you arrive." },
];

/**
 * The MJT House's own "calculate & pay" dues screen — same click-through shape
 * as the resort-wide Family Fest pay screen (FestDuesCalculator + PayView),
 * just with this house's per-day-only tiers and its own collector (Beth
 * Birkholz) instead of the resort's. Reached from MjtHouseDuesCard.
 */
export function MjtHouseDuesScreen({ slug }: { slug?: string | null }) {
  const { house, isMember, loading } = useResolvedHouse(slug);
  const back = slug ? `/house?house=${slug}` : "/house";
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("MJT House dues");

  if (loading) {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href={back} label="House" />
        <SkeletonList />
      </div>
    );
  }

  if (!house || !isMember || house.slug !== "mjt-house") {
    return (
      <div className="space-y-5 pt-2">
        <BackLink href="/" label="Home" />
        <div className="rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">🏠</p>
          <h1 className="mt-2 text-lg font-bold">No dues collection here</h1>
          <p className="mt-1 text-sm text-foreground/60">
            {!house || !isMember
              ? "This is a private house. Ask an admin to add you to see it."
              : "Only the MJT House collects its own Family Fest dues."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-1">
      <BackLink href={back} label={house.name} />

      <FestDuesCalculator
        dues={MJT_DUES}
        config={FAMILY_FEST}
        title="MJT House dues"
        noteLabel="MJT House dues"
        onChange={(nextAmount, nextNote) => {
          setAmount(nextAmount);
          setNote(nextNote);
        }}
      />

      <PayView
        payees={MJT_PAYEE}
        amount={amount}
        note={note}
        onAmountChange={setAmount}
        onNoteChange={setNote}
        title="Pay Beth"
        subtitle="Food & household items for the week — not pop or alcohol."
      />
    </div>
  );
}
