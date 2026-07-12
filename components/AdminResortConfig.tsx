"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/roles";
import { useSaveStatus } from "@/lib/hooks";
import { MigrationHint } from "@/components/MigrationHint";
import { SkeletonCard } from "@/components/Skeleton";
import { RESORT_CONFIG_FALLBACK, type ResortConfig } from "@/lib/resortConfig";

/**
 * Admin editor for the `resort_config` singleton (migration
 * [0082](supabase/migrations/0082_resort_config.sql)) — the Help page's human
 * escape-hatch contact (name/phone/email) plus basic public resort info
 * (address/phone/wifi/check-in). Read is public (see the migration's header
 * comment — the help contact is the sign-in escape hatch itself, so it can't
 * be gated behind sign-in), but writes are admin-only, enforced both by RLS
 * and this panel only rendering inside AdminGuard.
 *
 * `fetchResortConfig()` (lib/resortConfig.ts) is the read-side seam this
 * mirrors; this component just adds the write path + a "run the migration"
 * hint, matching the other admin editors (ContactPaySettings, AdminHouses).
 */
const FIELDS: {
  key: keyof ResortConfig;
  label: string;
  placeholder: string;
  hint?: string;
}[] = [
  { key: "helpContactName", label: "Help contact name", placeholder: "Brian" },
  {
    key: "helpContactPhone",
    label: "Help contact phone",
    placeholder: "+17155551234",
    hint: 'E.164 format (a leading "+" and country code, no spaces). Leave empty to hide text/call on the Help page.',
  },
  { key: "helpContactEmail", label: "Help contact email", placeholder: "you@email.com" },
  { key: "resortAddress", label: "Resort address", placeholder: "123 Lake Rd · Tomahawk, WI" },
  { key: "resortPhone", label: "Resort phone", placeholder: "+17155550100", hint: "E.164 format, same as above." },
  { key: "wifiNote", label: "Wifi note", placeholder: 'Network "MLR-Guest" · Password "..."' },
  { key: "checkinNote", label: "Check-in / check-out note", placeholder: "Check-in 4:00 PM · Check-out 11:00 AM" },
];

type ColRow = {
  help_contact_name: string | null;
  help_contact_phone: string | null;
  help_contact_email: string | null;
  resort_address: string | null;
  resort_phone: string | null;
  wifi_note: string | null;
  checkin_note: string | null;
};

function fromRow(row: ColRow): ResortConfig {
  return {
    helpContactName: row.help_contact_name ?? "",
    helpContactPhone: row.help_contact_phone ?? "",
    helpContactEmail: row.help_contact_email ?? "",
    resortAddress: row.resort_address ?? "",
    resortPhone: row.resort_phone ?? "",
    wifiNote: row.wifi_note ?? "",
    checkinNote: row.checkin_note ?? "",
  };
}

export function AdminResortConfig() {
  const [v, setV] = useState<ResortConfig>(RESORT_CONFIG_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false); // false until migration 0082 answers
  const { pending: saving, status, run } = useSaveStatus();

  useEffect(() => {
    (async () => {
      const sb = supabase;
      if (!isSupabaseConfigured || !sb) {
        setLoading(false);
        return;
      }
      const { data, error } = await sb
        .from("resort_config")
        .select(
          "help_contact_name, help_contact_phone, help_contact_email, resort_address, resort_phone, wifi_note, checkin_note",
        )
        .eq("id", true)
        .maybeSingle();
      if (error) {
        setReady(false);
      } else {
        setReady(true);
        if (data) setV(fromRow(data as ColRow));
      }
      setLoading(false);
    })();
  }, []);

  const set = (k: keyof ResortConfig, val: string) => setV((p) => ({ ...p, [k]: val }));

  const save = () =>
    run(async () => {
      const sb = supabase;
      if (!sb) return;
      const uid = await getCurrentUserId();
      // Singleton row (id = true, migration 0082) — upsert so this also
      // recovers cleanly if the seed row was somehow missing.
      const { error } = await sb.from("resort_config").upsert(
        {
          id: true,
          help_contact_name: v.helpContactName.trim(),
          help_contact_phone: v.helpContactPhone.trim(),
          help_contact_email: v.helpContactEmail.trim(),
          resort_address: v.resortAddress.trim(),
          resort_phone: v.resortPhone.trim(),
          wifi_note: v.wifiNote.trim(),
          checkin_note: v.checkinNote.trim(),
          updated_at: new Date().toISOString(),
          updated_by: uid,
        },
        { onConflict: "id" },
      );
      return error ? "Couldn't save." : "Saved ✓";
    });

  if (loading) return <SkeletonCard />;

  if (!ready) {
    return (
      <MigrationHint file="0082_resort_config.sql">
        To edit the resort&rsquo;s help contact & info in-app,
      </MigrationHint>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="text-xs font-medium text-foreground/70">{f.label}</span>
          <input
            value={v[f.key]}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={f.placeholder}
            className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
          {f.hint && <span className="mt-1 block text-[11px] text-foreground/45">{f.hint}</span>}
        </label>
      ))}
      <div className="flex items-center justify-end gap-3">
        {status && <span className="text-xs font-medium text-primary">{status}</span>}
        <button
          onClick={save}
          disabled={saving}
          className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
