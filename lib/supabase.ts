import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared Supabase client for passwordless email-OTP auth + data.
 *
 * ⭐ ONE identity across both apps (NEXT-STEPS.md §3): `mlr-app` and
 * `family-fest` MUST point at the SAME Supabase project — same auth, one
 * `profiles` table keyed by the auth user id. Both apps are served from the
 * same origin (…github.io), so the persisted session is shared: sign in once.
 *
 * The anon key is public-safe (it's protected by Row Level Security), so it
 * ships in the static bundle / as a repo Variable in CI.
 *
 * Until the env vars are set, `supabase` is null and `isSupabaseConfigured` is
 * false — the app still builds and runs, falling back to on-device identity
 * (the pre-backend behavior), so this is a clean drop-in.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true, // keep the session on the device …
        autoRefreshToken: true, // … and silently refresh it, so users stay in
        detectSessionInUrl: false,
      },
    })
  : null;
