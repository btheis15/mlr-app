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

⚠️ **For admin-edited member emails, run
[`0025`](migrations/0025_admin_profile_override.sql).** Members change their own
email in-app (no migration needed). This adds the **two-admin "break glass"** for
when an admin must change it *for* someone: `request_admin_override()` (each
admin votes; two distinct admins within 30 min open a **24h unlock**),
`admin_override_status()`, `cancel_admin_override()`, and `is_override_unlocked()`
(granted to `service_role` — the Mac mini re-checks it before writing). Until
it's run, the "Edit a member's information" panel shows a migration hint and the
self-serve change still works.

⚠️ **Then run [`0027`](migrations/0027_admin_set_member_profile.sql)** — extends
the same two-admin unlock to a member's **profile** info (name, household, phone,
contact/pay handles, birthday, address, bio). Adds `admin_set_member_profile(target, patch)`:
SECURITY DEFINER, allow-listed columns only (never `is_admin`/`id`/push prefs),
re-checks the unlock window itself. The login email still goes through the mini's
`/admin/set-email`. Until it's run, the "Edit info" form's profile save errors
(the email part still works).

⚠️ **For "new member joined" admin push, run
[`0026`](migrations/0026_new_member_notify.sql).** Adds
`profiles.notify_new_members` (admin opt-out, default on) and puts `profiles`
in the Realtime publication so the mini's push-sender hears the signup INSERT
and pushes every opted-in admin who joined and when. The admin-only toggle lives
in Profile → Notifications. Until it's run, the toggle just has no effect.

⚠️ **For the Notifications tab + Beta Tester role, run
[`0029`](migrations/0029_beta_tester_and_notif_prefs.sql) then
[`0030`](migrations/0030_notifications_feed.sql) (in that order).**
`0029` adds `profiles.beta_tester` (admin-assigned, never client-writable — set
via `set_beta_tester()`) and `profiles.notif_types` (the member's in-app
notification kinds, all on by default), and widens `admin_members()` to return
`beta_tester`. `0030` adds the `notifications` table (RLS: read/dismiss your own;
no client insert), puts it in the Realtime publication, and installs SECURITY
DEFINER **triggers** that fan out a notification per recipient on each source
event (post comments/replies, post & comment @mentions, post tags, post
reactions, new posts, committee-chat @mentions, committee join approve/decline),
plus the `mark_notifications_seen()` / `mark_notification_read(id)` /
`mark_all_notifications_read()` read-state RPCs and the admin
`send_broadcast_notification(title, body, url, audience, expires_at)` (audience ∈
`everyone` / `beta` / `admins`; bypasses `notif_types`). Until they're run the
Activity tab shows a migration hint and the badge stays empty. This is in-app
only — it does **not** touch the mini's push-sender.

⚠️ **To open the "Email members" tool to all members, run
[`0031`](migrations/0031_email_open_to_members.sql).** Adds
`directory_recipients()` (any signed-in member → the whole directory, to
hand-pick a custom list) and **widens** the gates on the existing functions:
`all_member_recipients()` now allows **App Admin OR anyone in any committee**
(was admin-only), and `committee_member_recipients(cid)` now allows **any member
of that committee** (was its Lead/admin). Same contact_email→login-email rule as
0028. Privacy: the directory exposes each member's best email to every signed-in
member (consistent with the member card). Until it's run, the member-facing
"Email members" picker shows a migration hint.

⚠️ **For "Request a Cabin Stay", run
[`0032`](migrations/0032_cabin_bookings.sql).** Adds `cabins` (seeded: Cabin 1 =
3 rooms, Red & White House = 4) and `cabin_bookings`, plus the RPCs
`request_cabin_stay()`, `review_cabin_stay()` (admin-only, with a per-night
capacity guard), `cancel_cabin_stay()`, `cabin_availability()` (any member, for
the "X of Y rooms left" view), and `cabin_booking_notification()` (`service_role`
only — the mini reads it to push + email a decision). It also puts
`cabin_bookings` in the Realtime publication (with `REPLICA IDENTITY FULL`) so
the mini's **push-sender** notifies admins of new requests + the requester of a
decision, and the **alert-mailer** emails the requester a confirmation. After
running it, restart the mini (`com.mlr.media-server`) so both pick up the new
listeners. No new env vars — reuses the existing VAPID + SMTP config. Until it's
run, the Request a Cabin Stay page shows a "coming soon".

## Auth note

Passwordless **email OTP** (NEXT-STEPS §3b). Supabase's built-in mailer is
rate-limited, so plug in free SMTP (Resend free tier or Gmail) under
Authentication → Email before real use.

### Auth emails: send a code, not a link (every template)

The app verifies one-time **codes** in-app (`verifyOtp`) and never opens a magic
link — that's deliberate, so it works inside the installed PWA. Supabase, by
default, emails magic-link URLs instead, and it uses a **different template per
situation**, so editing only one leaves the others sending links (and a member
getting two confusing emails). In **Authentication → Emails**, set the body of
**every** template the app triggers to use `{{ .Token }}` (not
`{{ .ConfirmationURL }}`):

| Template | When it's sent |
|---|---|
| **Confirm signup** | a brand-new email signs in / is invited |
| **Magic Link** | a returning member signs in |
| **Change Email Address** | a member changes their email (self-serve) |
| **Invite user** | only if `inviteUserByEmail` is used directly |

Sample body:

```html
<h2>Your code</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>It expires shortly. If you didn't request it, ignore this email.</p>
```

Also: **Sign In / Providers → Email → "Email OTP Length"** → **8** (the app
accepts 6–8). Keep **"Secure email change" ON** — a self-serve email change then
confirms via a code to the new address (with a heads-up to the old one), which
the app verifies with `verifyOtp({ type: "email_change" })`.
