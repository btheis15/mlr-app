"use client";

import { useState } from "react";
import type { Payee } from "@/lib/types";

/**
 * Pay the fest organizers. Venmo is the primary path — the button opens Venmo
 * pre-filled with the amount and note, so the payment happens in the user's own
 * Venmo account. Zelle has no universal deep link, so we surface the handle with
 * a copy button. No payment credentials live in the app.
 */
export function PayView({ payees }: { payees: Payee[] }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("Family Fest");

  return (
    <div className="space-y-6 pt-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Pay</h1>
        <p className="text-sm text-foreground/60">
          Square up with the folks running the fest.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-xs text-foreground/60">
            Amount (optional)
            <div className="flex items-center rounded-xl bg-background px-3 ring-1 ring-border focus-within:ring-2 focus-within:ring-primary">
              <span className="text-sm text-foreground/50">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="w-full bg-transparent px-1 py-2 text-sm outline-none"
              />
            </div>
          </label>
          <label className="flex flex-[2] flex-col gap-1 text-xs text-foreground/60">
            Note
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>
        <p className="text-xs text-foreground/40">
          The amount &amp; note pre-fill Venmo when you tap Pay.
        </p>
      </section>

      <ul className="space-y-3">
        {payees.map((p) => (
          <PayeeCard key={p.id} payee={p} amount={amount} note={note} />
        ))}
      </ul>
    </div>
  );
}

function PayeeCard({
  payee,
  amount,
  note,
}: {
  payee: Payee;
  amount: string;
  note: string;
}) {
  const [copied, setCopied] = useState(false);

  const venmoUrl = (() => {
    if (!payee.venmo) return null;
    const params = new URLSearchParams({ txn: "pay" });
    if (amount) params.set("amount", amount);
    if (note) params.set("note", note);
    return `https://venmo.com/${encodeURIComponent(payee.venmo)}?${params.toString()}`;
  })();

  const copyZelle = async () => {
    if (!payee.zelle) return;
    try {
      await navigator.clipboard.writeText(payee.zelle);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <li className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div>
        <p className="text-sm font-semibold">{payee.name}</p>
        <p className="text-xs text-foreground/50">{payee.role}</p>
      </div>

      {venmoUrl && (
        <a
          href={venmoUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl bg-[#3D95CE] py-2.5 text-sm font-semibold text-white"
        >
          Pay @{payee.venmo} with Venmo
        </a>
      )}

      {payee.zelle && (
        <button
          onClick={copyZelle}
          className="flex w-full items-center justify-between gap-2 rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border"
        >
          <span className="text-foreground/70">
            Zelle: <span className="font-medium text-foreground">{payee.zelle}</span>
          </span>
          <span className="text-xs text-primary">{copied ? "Copied!" : "Copy"}</span>
        </button>
      )}
    </li>
  );
}
