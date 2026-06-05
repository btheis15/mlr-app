"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/roles";
import { useSaveStatus } from "@/lib/hooks";
import { BirthdayPicker } from "@/components/BirthdayPicker";
import { AddressEditor } from "@/components/AddressEditor";
import { isApple } from "@/lib/push";

// Profile section to set your phone + pay handles and pick your preferred
// contact/pay methods — what the member card defaults to. Each is optional.
// Degrades to a gentle note until migration 0006 is run.
const FIELDS: { key: string; label: string; placeholder: string; hint?: string; type?: string }[] = [
  { key: "phone", label: "Phone (call / text / Apple Cash)", placeholder: "+1 715 555 0123" },
  { key: "contact_email", label: "Email for contact", placeholder: "you@email.com", hint: "Defaults to the email you signed up with — change it to be reached somewhere else." },
  { key: "venmo", label: "Venmo", placeholder: "username" },
  { key: "zelle", label: "Zelle", placeholder: "phone or email" },
  { key: "cashapp", label: "Cash App", placeholder: "$cashtag" },
  { key: "paypal", label: "PayPal", placeholder: "paypal.me/you or email" },
];
const KEYS = [...FIELDS.map((f) => f.key), "pay_preferred", "contact_preferred", "birthday", "address"];

export function ContactPaySettings() {
  const [v, setV] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);
  const { pending: saving, status, run } = useSaveStatus();
  const [appleCash, setAppleCash] = useState(false);

  useEffect(() => {
    (async () => {
      if (!supabase) {
        setLoaded(true);
        return;
      }
      const id = await getCurrentUserId();
      if (!id) {
        setLoaded(true);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select(KEYS.join(", ") + ", apple_cash")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        setAvailable(false);
        setLoaded(true);
        return;
      }
      const row = (data ?? {}) as Record<string, unknown>;
      const init: Record<string, string> = {};
      for (const k of KEYS) init[k] = (row[k] as string | null) ?? "";
      setV(init);
      setAppleCash(Boolean(row.apple_cash));
      setLoaded(true);
    })();
  }, []);

  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  const save = () =>
    run(async () => {
      const sb = supabase;
      if (!sb) return;
      const id = await getCurrentUserId();
      if (!id) return;
      const row: Record<string, unknown> = {};
      for (const k of KEYS) row[k] = (v[k] ?? "").trim() || null;
      row.apple_cash = appleCash;
      const { error } = await sb.from("profiles").update(row).eq("id", id);
      return error ? "Couldn't save." : "Saved ✓";
    });

  if (!loaded) return null;
  if (!available) {
    return (
      <p className="rounded-2xl bg-card p-4 text-xs text-foreground/50 ring-1 ring-border">
        Contact &amp; payment setup appears here once the one-time database step (migration 0006) is run.
      </p>
    );
  }

  const contactOpts: [string, string][] = ([["text", "Text"], ["call", "Call"], ["email", "Email"]] as [string, string][]).filter(
    ([k]) => (k === "email" ? v.contact_email : v.phone),
  );
  const payOpts: [string, string][] = ([["venmo", "Venmo"], ["zelle", "Zelle"], ["applecash", "Apple Cash"], ["cashapp", "Cash App"], ["paypal", "PayPal"]] as [string, string][]).filter(
    ([k]) => (k === "applecash" ? isApple() && appleCash && v.phone : v[k]),
  );

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="text-xs font-medium text-foreground/70">{f.label}</span>
          <input
            value={v[f.key] ?? ""}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={f.placeholder}
            type={f.type ?? "text"}
            className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          {f.hint && <span className="mt-1 block text-[11px] text-foreground/45">{f.hint}</span>}
        </label>
      ))}
      <div>
        <span className="text-xs font-medium text-foreground/70">Birthday</span>
        <BirthdayPicker value={v.birthday ?? ""} onChange={(val) => set("birthday", val)} />
        <span className="mt-1 block text-[11px] text-foreground/45">Shown on your member card with your age, so folks can wish you a happy birthday.</span>
      </div>
      <div>
        <span className="text-xs font-medium text-foreground/70">Address</span>
        <div className="mt-1">
          <AddressEditor value={v.address ?? ""} onChange={(val) => set("address", val)} />
        </div>
        <span className="mt-1 block text-[11px] text-foreground/45">Tap to enter it and verify it on the map; members can tap it on your card for directions.</span>
      </div>
      {isApple() && (
        <label className="flex items-center justify-between gap-3 rounded-xl bg-background p-3 ring-1 ring-border">
          <span className="min-w-0">
            <span className="text-xs font-medium text-foreground/70">Accept Apple Cash</span>
            <span className="mt-0.5 block text-[11px] text-foreground/45">Sends via Messages to your phone number. Shown on your card only to other Apple users.</span>
          </span>
          <input type="checkbox" checked={appleCash} onChange={(e) => setAppleCash(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
        </label>
      )}
      <label className="block">
        <span className="text-xs font-medium text-foreground/70">Preferred way to be contacted</span>
        <select
          value={v.contact_preferred ?? ""}
          onChange={(e) => set("contact_preferred", e.target.value)}
          className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">No preference</option>
          {contactOpts.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-foreground/70">Preferred way to be paid</span>
        <select
          value={v.pay_preferred ?? ""}
          onChange={(e) => set("pay_preferred", e.target.value)}
          className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">No preference</option>
          {payOpts.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-end gap-3">
        {status && <span className="text-xs font-medium text-primary">{status}</span>}
        <button onClick={save} disabled={saving} className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
