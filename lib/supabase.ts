import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase browser client — the single backend for the resort app *and* the
 * Family Fest section (one project, one identity, NEXT-STEPS §3).
 *
 * Build-safe by design: if the public env vars aren't set (e.g. a CI build
 * before the secrets are wired), `supabase` is `null` and
 * `isSupabaseConfigured` is `false` — the app still builds and feature code
 * falls back to read-only (see `lib/features.ts` `READ_ONLY`). The publishable
 * key is meant to ship in the client; access is gated by row-level security.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true, // keep the session on-device (the "stay logged in")
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
