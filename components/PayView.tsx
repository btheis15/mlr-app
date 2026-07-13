"use client";

import { useState } from "react";
import type { Payee } from "@/lib/types";

/**
 * Pay the fest organizers. Venmo is the primary path — the button opens Venmo
 * pre-filled with the amount and note, so the payment happens in the user's own
 * Venmo account. Zelle has no universal deep link, so we surface the handle with
 * a copy button. No payment credentials live in the app.
 *
 * Amount/note are controlled from the parent so the dues calculator
 * (`FestDuesCalculator`) can auto-fill them from a member's stepper picks —
 * typing directly into either field still works exactly the same.
 */
export function PayView({
  payees,
  amount,
  note,
  onAmountChange,
  onNoteChange,
  title = "Pay",
  subtitle = "Square up with the folks running the fest.",
}: {
  payees: Payee[];
  amount: string;
  note: string;
  onAmountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  /** Override for a non-Family-Fest payee screen (e.g. a house's own dues). */
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-6 pt-2">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted">{subtitle}</p>
      </header>

      <section className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
            Amount (optional)
            <div className="flex items-center rounded-xl bg-background px-3 ring-1 ring-border focus-within:ring-2 focus-within:ring-primary">
              <span className="text-sm text-foreground/50">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className="w-full bg-transparent px-1 py-2 text-sm outline-none"
              />
            </div>
          </label>
          <label className="flex flex-[2] flex-col gap-1 text-xs text-muted">
            Note
            <input
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              className="rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>
        <p className="text-xs text-faint">
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

  // PayPal: a paypal.me link if the handle isn't already an email; emails just
  // get copied (there's no universal pay-by-email deep link).
  const paypalUrl = (() => {
    if (!payee.paypal) return null;
    if (payee.paypal.includes("@")) return null;
    const handle = payee.paypal.replace(/^@/, "");
    const base = `https://paypal.me/${encodeURIComponent(handle)}`;
    return amount ? `${base}/${amount}` : base;
  })();

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copy = async (label: string, value?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setCopiedField(null);
      }, 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <li className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div>
        <p className="text-sm font-semibold">{payee.name}</p>
        <p className="text-xs text-muted">{payee.role}</p>
        {payee.note && <p className="mt-1 text-xs text-muted">{payee.note}</p>}
      </div>

      {venmoUrl && (
        <a
          href={venmoUrl}
          target="_blank"
          rel="noreferrer"
          className="press flex items-center justify-center gap-2 rounded-xl bg-venmo py-2.5 text-sm font-semibold text-white"
        >
          Pay @{payee.venmo} with Venmo
        </a>
      )}

      {paypalUrl && (
        <a
          href={paypalUrl}
          target="_blank"
          rel="noreferrer"
          className="press flex items-center justify-center gap-2 rounded-xl bg-paypal py-2.5 text-sm font-semibold text-white"
        >
          Pay with PayPal
        </a>
      )}

      {payee.zelle && (
        <button
          onClick={() => copy("zelle", payee.zelle)}
          className="press flex w-full items-center justify-between gap-2 rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border"
        >
          <span className="text-foreground/70">
            Zelle: <span className="font-medium text-foreground">{payee.zelle}</span>
          </span>
          <span className="text-xs text-primary">{copied && copiedField === "zelle" ? "Copied!" : "Copy"}</span>
        </button>
      )}

      {payee.applecash && (
        <button
          onClick={() => copy("applecash", payee.applecash)}
          className="press flex w-full items-center justify-between gap-2 rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border"
        >
          <span className="text-foreground/70">
            Apple Cash: <span className="font-medium text-foreground">{payee.applecash}</span>
          </span>
          <span className="text-xs text-primary">{copied && copiedField === "applecash" ? "Copied!" : "Copy"}</span>
        </button>
      )}

      {payee.paypal && !paypalUrl && (
        <button
          onClick={() => copy("paypal", payee.paypal)}
          className="press flex w-full items-center justify-between gap-2 rounded-xl bg-background px-3 py-2.5 text-sm ring-1 ring-border"
        >
          <span className="text-foreground/70">
            PayPal: <span className="font-medium text-foreground">{payee.paypal}</span>
          </span>
          <span className="text-xs text-primary">{copied && copiedField === "paypal" ? "Copied!" : "Copy"}</span>
        </button>
      )}
    </li>
  );
}
