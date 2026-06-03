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

⚠️ **Then run [`0009`](migrations/0009_admin_remove_member.sql),
[`0010`](migrations/0010_profiles_insert_guard.sql), and
[`0011`](migrations/0011_admin_signin_log.sql).**
- `0009` — `delete_member(target)`: admin-only hard delete of a member (their
  `auth.users` row, cascading to all their content). Can't delete yourself or an
  admin (demote first). Powers the **Remove** button in Admin → Members.
- `0010` — closes the one privilege-escalation gap left by `0001`: clients
  could `UPDATE` only non-`is_admin` columns, but `INSERT` wasn't column-locked.
  Adds `is_admin = false` to the profiles insert policy.
- `0011` — `recent_signins(limit_n)`: admin-only read of GoTrue's
  `auth.audit_log_entries` (event + email + **IP**), powering Admin → Recent
  sign-ins. The app resolves each IP to an approximate city/country client-side.

⚠️ **For committee chat, run [`0012`](migrations/0012_committees.sql),
[`0013`](migrations/0013_committee_chat.sql), and
[`0014`](migrations/0014_committee_reads.sql) in order.**
- `0012` — makes committees real (they were seed-only): `committees` (seeded
  from `lib/data.ts`), `committee_members`, and `committee_join_requests`, plus
  the gated RPCs `request_to_join()`, `review_join_request()`,
  `set_committee_member()` and the `is_committee_member()` helper. Membership
  only moves through those RPCs; admins get a blanket override (they moderate
  every room, and it bootstraps the first member).
- `0013` — the private per-committee chat: `committee_messages` (+ inline
  `reply_to_id`), `committee_message_media` (image/video/sticker/gif),
  `committee_message_reactions`, `committee_message_mentions`. **The whole point
  is the RLS:** read/post is allowed only if `is_committee_member()` — so a chat
  is invisible to anyone not in that committee, enforced in the database. Realtime
  is enabled on all four. Until it's run, the chat screen shows "coming soon".
- `0014` — `committee_reads.last_read_at` per member, for the unread badge on
  the committee's "Open chat" button. Each member reads/writes only their own row.

## Auth note

Passwordless **email OTP** (NEXT-STEPS §3b). Supabase's built-in mailer is
rate-limited, so plug in free SMTP (Resend free tier or Gmail) under
Authentication → Email before real use.
