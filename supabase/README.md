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

⚠️ **After pulling the photo-timeline change, run
[`0005_post_occurred_at.sql`](migrations/0005_post_occurred_at.sql).** It adds
`posts.occurred_at` (the moment a post is *about*, separate from when it was
uploaded) plus an UPDATE policy so authors/admins can edit a post's date & time.
The app detects whether the column exists: until you run it, the feed falls back
to `created_at` and the backdate controls stay hidden — so nothing breaks, the
feature just isn't active yet.

⚠️ **For admin member management, run
[`0008_admin_members.sql`](migrations/0008_admin_members.sql).** It adds two
admin-gated functions — `admin_members()` (the directory **+ private emails**,
which we deliberately keep out of the world-readable `profiles` table) and
`set_admin(target, value)` (grant/revoke admin; you can't remove your own). The
Profile → Admin → Members list works without it (names only, from the public
`profiles` read); emails + the promote/remove buttons switch on once it's run.

## Auth note

Passwordless **email OTP** (NEXT-STEPS §3b). Supabase's built-in mailer is
rate-limited, so plug in free SMTP (Resend free tier or Gmail) under
Authentication → Email before real use.
