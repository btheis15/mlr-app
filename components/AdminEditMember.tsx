"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSaveStatus } from "@/lib/hooks";
import { setMemberEmail } from "@/lib/admin";
import { BirthdayPicker } from "@/components/BirthdayPicker";
import { AddressEditor } from "@/components/AddressEditor";

// Admin edit of ANOTHER member's info, the backup for when a member can't do it
// themselves. Profile fields go through the admin_set_member_profile RPC
// (migration 0027 — admin + two-admin-unlock gated, server-side); the login
// email goes through the mini's /admin/set-email (auth.users). Only shown while
// the override window is open (AdminMembers gates it; the server re-checks too).

const TEXT_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: "display_name", label: "Name" },
  { key: "household", label: "Household / cabin" },
  { key: "phone", label: "Phone", placeholder: "+1 715 555 0123" },
  { key: "contact_email", label: "Contact email", placeholder: "where to reach them" },
  { key: "venmo", label: "Venmo" },
  { key: "zelle", label: "Zelle" },
  { key: "cashapp", label: "Cash App" },
  { key: "paypal", label: "PayPal" },
];
// Every profile column the form owns (sent in the patch). apple_cash is a boolean
// kept separate; the rest are text/date loaded into `v`.
const TEXT_KEYS = [...TEXT_FIELDS.map((f) => f.key), "pay_preferred", "contact_preferred", "birthday", "address", "bio"];

interface Props {
  memberId: string;
  memberEmail: string | null;
  memberName: string;
  onClose: () => void;
  /** Bubble the saved name/email up so the list row updates without a reload. */
  onSaved: (patch: { email?: string; display_name?: string }) => void;
}

export function AdminEditMember({ memberId, memberEmail, memberName, onClose, onSaved }: Props) {
  const [v, setV] = useState<Record<string, string>>({});
  const [appleCash, setAppleCash] = useState(false);
  const [email, setEmail] = useState(memberEmail ?? "");
  const [loaded, setLoaded] = useState(false);
  const { pending, status, show, run } = useSaveStatus();

  useEffect(() => {
    (async () => {
      const sb = supabase;
      if (!sb) { setLoaded(true); return; }
      // profiles is world-readable, so we can load the target's current values.
      const { data } = await sb
        .from("profiles")
        .select(TEXT_KEYS.join(", ") + ", apple_cash")
        .eq("id", memberId)
        .maybeSingle();
      const row = (data ?? {}) as Record<string, unknown>;
      const init: Record<string, string> = {};
      for (const k of TEXT_KEYS) init[k] = (row[k] as string | null) ?? "";
      setV(init);
      setAppleCash(Boolean(row.apple_cash));
      setLoaded(true);
    })();
  }, [memberId]);

  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const getToken = async () =>
    (await supabase?.auth.getSession())?.data.session?.access_token ?? null;

  const save = () =>
    run(async () => {
      const sb = supabase;
      if (!sb) return "Sign-in isn't available.";

      const nextEmail = email.trim().toLowerCase();
      const emailChanged = !!nextEmail && nextEmail !== (memberEmail ?? "").toLowerCase();
      if (emailChanged && !/\S+@\S+\.\S+/.test(nextEmail)) return "Enter a valid email.";

      // 1) Profile fields → the gated RPC (sends every field the form owns).
      const patch: Record<string, unknown> = { apple_cash: appleCash };
      for (const k of TEXT_KEYS) patch[k] = (v[k] ?? "").trim();
      const { error: pErr } = await sb.rpc("admin_set_member_profile", { target: memberId, patch });
      if (pErr) return pErr.message;

      // 2) Login email → the mini (auth.users), only if it changed.
      if (emailChanged) {
        const token = await getToken();
        if (!token) return "Saved the profile, but sign in again to change the email.";
        try {
          await setMemberEmail(memberId, nextEmail, token);
        } catch (e) {
          return e instanceof Error ? e.message : "Saved the profile, but couldn't change the email.";
        }
      }

      onSaved({
        email: emailChanged ? nextEmail : undefined,
        display_name: (v.display_name ?? "").trim() || undefined,
      });
      onClose();
      return "Saved ✓";
    }, 0);

  if (!loaded) return <p className="px-1 py-2 text-center text-xs text-foreground/45">Loading…</p>;

  const contactOpts: [string, string][] = ([["text", "Text"], ["call", "Call"], ["email", "Email"]] as [string, string][])
    .filter(([k]) => (k === "email" ? v.contact_email : v.phone));
  const payOpts: [string, string][] = ([["venmo", "Venmo"], ["zelle", "Zelle"], ["applecash", "Apple Cash"], ["cashapp", "Cash App"], ["paypal", "PayPal"]] as [string, string][])
    .filter(([k]) => (k === "applecash" ? appleCash && v.phone : v[k]));

  return (
    <div className="space-y-3 rounded-lg bg-card p-3 ring-1 ring-primary/30">
      <p className="text-xs text-foreground/60">
        Editing <strong>{memberName}</strong> on their behalf. Changes save to their profile (and login email) right away.
      </p>

      <label className="block">
        <span className="text-xs font-medium text-foreground/70">Login email</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="member@email.com"
          type="email"
          autoComplete="off"
          className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
      </label>

      {TEXT_FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="text-xs font-medium text-foreground/70">{f.label}</span>
          <input
            value={v[f.key] ?? ""}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={f.placeholder}
            className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      ))}

      <div>
        <span className="text-xs font-medium text-foreground/70">Birthday</span>
        <BirthdayPicker value={v.birthday ?? ""} onChange={(val) => set("birthday", val)} />
      </div>
      <div>
        <span className="text-xs font-medium text-foreground/70">Address</span>
        <div className="mt-1">
          <AddressEditor value={v.address ?? ""} onChange={(val) => set("address", val)} />
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-xl bg-background p-3 ring-1 ring-border">
        <span className="text-xs font-medium text-foreground/70">Accepts Apple Cash</span>
        <input type="checkbox" checked={appleCash} onChange={(e) => setAppleCash(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-foreground/70">Preferred contact</span>
        <select
          value={v.contact_preferred ?? ""}
          onChange={(e) => set("contact_preferred", e.target.value)}
          className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">No preference</option>
          {contactOpts.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-foreground/70">Preferred payment</span>
        <select
          value={v.pay_preferred ?? ""}
          onChange={(e) => set("pay_preferred", e.target.value)}
          className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">No preference</option>
          {payOpts.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
        </select>
      </label>

      {status && <p className="text-xs text-foreground/60">{status}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => { show(null); onClose(); }}
          className="press rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-foreground/60 ring-1 ring-border"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="press rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
