"use client";

import { useState } from "react";
import { BackLink } from "@/components/BackLink";
import { PayView } from "@/components/PayView";
import { FestDuesCalculator } from "@/components/FestDuesCalculator";
import { SignInWall } from "@/components/Guard";
import { useFestContent } from "@/lib/useFestContent";

export default function PayPage() {
  const { dues, payees, config } = useFestContent({ realtime: true });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("Family Fest");

  return (
    <div className="space-y-3 pt-1">
      <BackLink href="/family-fest" label="Family Fest" />

      <SignInWall
        title="Pay"
        note="Payment details (who to pay and how) are kept private. Add your name & email to see them."
      >
        {/* Dues tiers — admin-editable amounts (TBD until set in the Planner). */}
        <FestDuesCalculator
          dues={dues}
          config={config}
          onChange={(nextAmount, nextNote) => {
            setAmount(nextAmount);
            setNote(nextNote);
          }}
        />

        <PayView
          payees={payees}
          amount={amount}
          note={note}
          onAmountChange={setAmount}
          onNoteChange={setNote}
        />
      </SignInWall>
    </div>
  );
}
