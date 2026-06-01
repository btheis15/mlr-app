# Supabase

Backend for the resort app **and** the embedded Family Fest section — one
project, one identity (NEXT-STEPS §3). The publishable key ships in the client;
everything is gated by **row-level security**.

## Env vars (public, client-safe)

| Var | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` (dev) · Vercel env · GitHub Actions repo **variable** (Pages build) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same three places |

`lib/supabase.ts` reads these. If they're absent the client is `null` and
`isSupabaseConfigured` is `false`, so the app still builds (falls back to
read-only).

## Applying migrations

Migrations live in [`migrations/`](migrations/), in order. Two ways to apply:

- **SQL editor (simplest):** open the file, copy its contents into the Supabase
  dashboard → SQL Editor → Run.
- **CLI:** `supabase link --project-ref <ref>` then `supabase db push`.

Start with [`0001_profiles.sql`](migrations/0001_profiles.sql) — the shared
`profiles` table + auto-create-on-signup trigger + RLS. Feature tables (posts,
rsvps, committees + join requests, announcements) are added as each feature is
wired to the DB.

## Auth note

Passwordless **email OTP** (NEXT-STEPS §3b). Supabase's built-in mailer is
rate-limited, so plug in free SMTP (Resend free tier or Gmail) under
Authentication → Email before real use.
