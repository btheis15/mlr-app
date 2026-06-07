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

⚠️ **For role tiers + broadcast alerts, run
[`0015`](migrations/0015_roles_and_alerts.sql).** Three member tiers:
**App Admin** (`profiles.is_admin`, does everything) › **Committee Lead**
(`committee_members.role = 'Lead'`) › **Member**. Leads can add/approve/remove
members of *their* committee (the `review_join_request` / `set_committee_member`
RPCs are now lead-aware; a lead can't remove another lead — only an app admin
can); only app admins set leads (`set_committee_lead`). Also adds the
`announcements` table (broadcast banner notices) — insert gated to
`can_post_alerts()` = app admins **+ Family Fest leads** — with Realtime, and
`alert_recipients()` (opted-in member emails, granted only to `service_role` for
the mini's mailer). Until it's run, leads are app-admins-only and the alert
composer just posts a device-local notice.

⚠️ **Then run [`0016`](migrations/0016_alerts_admin_only.sql)** — narrows
`can_post_alerts()` to **App Admins only** (0015 also allowed Family Fest leads).
App-wide alerts (banner + email) are admin-only; Committee Leads keep their
member-management powers. The `announcements` INSERT policy already calls the
function, so this one redefinition is all it takes.

⚠️ **Then run [`0017`](migrations/0017_alert_audience.sql)** — adds
`announcements.email_audience` ('all' | 'admins') and gives `alert_recipients()`
an `audience` arg (default 'all', kept so the arg-less call still works). Lets an
App Admin send an alert whose **email goes only to other App Admins** (the banner
is still seen by everyone). Recipients with App Admin access get it regardless of
which committees they lead — roles are additive.

## Auth note

Passwordless **email OTP** (NEXT-STEPS §3b). Supabase's built-in mailer is
rate-limited, so plug in free SMTP (Resend free tier or Gmail) under
Authentication → Email before real use.

### Send a numeric code, not a magic link

The app calls `signInWithOtp` + `verifyOtp({ type: "email" })` — it only ever
wants the **code**, never a clickable link. But by default Supabase's email
sends a magic-link URL, so users get a link instead of (or alongside) the code.
That's a dashboard setting, not an app change:

1. **Authentication → Emails → "Magic Link" template** — replace the body with
   the **token**, e.g.

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in the app:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>It expires shortly. If you didn't request it, ignore this email.</p>
   ```

   Using `{{ .Token }}` (not `{{ .ConfirmationURL }}`) is what makes the email a
   code-only email. `signInWithOtp` uses this template, so this one change
   covers both new sign-ups and returning sign-ins.
2. **Authentication → Sign In / Providers → Email → "Email OTP Length"** — set
   to **8** (the sign-in sheet already accepts a 6–8 digit code).
3. Optionally shorten "Email OTP Expiration" to taste.
