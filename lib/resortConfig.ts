// The Help page's human escape-hatch contact (name/phone/email), backed by
// the singleton `resort_config` table (migration 0082) so an admin can edit
// it in-app instead of shipping a new build. Read is public (see the
// migration's header comment for why — the help contact is the sign-in
// escape hatch itself).
//
// The table also carries legacy resort_address/resort_phone/wifi_note/
// checkin_note columns from when this was modeled as "resort info" — MLR is
// an old family place, not an operating resort, so nothing reads or edits
// those anymore; they're simply ignored.
//
// The values below mirror what used to be hard-coded in lib/help.ts
// (HELP_CONTACT) — kept here ONLY as the fallback
// for when Supabase isn't configured yet, or the 0082 migration hasn't run
// (`isMissingTable`, same 42P01 check NotificationsView uses). Once the
// migration has run, the DB row is the source of truth, including an
// intentionally-empty field (e.g. an admin clearing the phone to force the
// email-only fallback) — that's a valid configuration, not an error.

import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface ResortConfig {
  helpContactName: string;
  helpContactPhone: string;
  helpContactEmail: string;
}

/** The hard-coded values this table was seeded from (migration 0082). Used
 *  verbatim when Supabase isn't configured, the table/migration isn't there
 *  yet, or the singleton row is somehow missing. */
export const RESORT_CONFIG_FALLBACK: ResortConfig = {
  helpContactName: "Brian",
  helpContactPhone: "+12248005389",
  helpContactEmail: "brian.theis15@gmail.com",
};

type PgError = { code?: string; message?: string } | null;

function isMissingTable(error: PgError): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

/** Fetch the live resort config. Falls back to `RESORT_CONFIG_FALLBACK`
 *  whenever the live value can't be trusted to be there (no Supabase, no
 *  table yet, unexpected error, or no row) — never throws. */
export async function fetchResortConfig(): Promise<ResortConfig> {
  const sb = supabase;
  if (!isSupabaseConfigured || !sb) return RESORT_CONFIG_FALLBACK;
  try {
    const { data, error } = await sb
      .from("resort_config")
      .select("help_contact_name, help_contact_phone, help_contact_email")
      .eq("id", true)
      .maybeSingle();
    if (error) {
      // Missing table (migration not run yet) or any other read failure —
      // this feeds the sign-in escape hatch, so always degrade to the
      // known-good fallback rather than surface an error.
      if (!isMissingTable(error)) {
        console.warn("fetchResortConfig: falling back after read error", error.message);
      }
      return RESORT_CONFIG_FALLBACK;
    }
    if (!data) return RESORT_CONFIG_FALLBACK;
    return {
      helpContactName: data.help_contact_name ?? "",
      helpContactPhone: data.help_contact_phone ?? "",
      helpContactEmail: data.help_contact_email ?? "",
    };
  } catch {
    return RESORT_CONFIG_FALLBACK;
  }
}
