# CLAUDE.md — mlr-app

Entry point for Claude/AI sessions on this repo. Read this first.

## What this repo is

A **Next.js 16 + React 19 + Tailwind v4 PWA** for **Muskellunge Lake Resort
(MLR)** — the year-round resort app. Mobile-first, vertical, **light mode only**,
built around the official **forest-green** MLR logo (white cabin-in-the-pines,
EST 1987) with vintage heritage from the original resort (Leo & Dorothy Theis ·
Fishing · Hunting · Boating · light-housekeeping cabins · Tomahawk, WI). Same
conventions as the author's other apps (`stock-game`, `innjoy-mobile`): App
Router, CSS-variable theme tokens, bottom `TabBar`, iOS install hint. Live on
**Vercel** (mlr-app-omega.vercel.app) + GitHub Pages; currently **read-only**
(see `lib/features.ts` `READ_ONLY`).

MLR is the **umbrella app**, and **Family Fest** (the one-week annual gathering)
is now a **built-in section** of it at `/family-fest/*` — schedule, dinners,
crew/RSVP, photos, pay, plus anytime "things to do" (the scavenger hunt). There's
no separate app and no "open the full app" hop anymore. The section keeps its own
**Renaissance / parchment look**, scoped via the `.ff-section` class +
[`app/family-fest/layout.tsx`](app/family-fest/layout.tsx) (Cinzel font), and has
its own in-section sub-nav ([`FamilyFestNav`](components/FamilyFestNav.tsx)); the
forest-green resort chrome (bottom tabs, announcements) stays above it. *(The
standalone `family-fest` repo is being retired/redirected to this section.)*

**One-app feel via a shared "season"** — rather than the full code merge (still
deferred to the Supabase phase, NEXT-STEPS §0b), both apps share a **Family Fest
season model** ([`lib/festSeason.ts`](lib/festSeason.ts), mirrored byte-for-byte
in the `family-fest` repo) so the fest reads as a *season of the resort* that
rises and recedes through the year across four phases: **off-season** (quiet
banner) → **planning** (from ~60 days out: a partial takeover that rallies
volunteers and previews what's being planned) → **live** (the event week: MLR
leads with Family Fest — a "Day n of N + today's events" takeover, a live dot on
the tab, resort content recedes) → **wrap** (2 weeks after: the full takeover
lingers, nudging people to post the photos they didn't get to). See **Family
Fest season** below.

**Data model:** client-only for now. Resort content (activities, dining,
amenities, Family Fest highlights) is static in [`lib/data.ts`](lib/data.ts);
types in [`lib/types.ts`](lib/types.ts). Identity, chat, alert dismissals, and
admin-posted alerts persist per-device in `localStorage`. Several features are
deliberately scaffolded with a clean seam for a backend — see **Backend seams**.

## The tabs

| Route | File | Status |
|---|---|---|
| `/` | [`app/page.tsx`](app/page.tsx) | Home — **kept lean**: Family Fest season spotlight ([`FamilyFestSpotlight`](components/FamilyFestSpotlight.tsx)), the nearest-event spotlight + RSVP ([`UpcomingEvents`](components/UpcomingEvents.tsx)), resort cards ([`HomePreFestCards`](components/HomePreFestCards.tsx) — Events / Work Weekends / Committees / Cabin), front-desk call, one-line heritage |
| `/activities` | [`app/activities/page.tsx`](app/activities/page.tsx) | Resort activities grouped by category |
| `/family-fest` | [`app/family-fest/`](app/family-fest/) | **Family Fest section** (its own `.ff-section` theme + [`FamilyFestNav`](components/FamilyFestNav.tsx) sub-nav). Overview ([`page.tsx`](app/family-fest/page.tsx): poster + [`FestStatus`](components/FestStatus.tsx) + next-up) · `schedule` (+ anytime [`THINGS_TO_DO`](lib/data.ts) & `schedule/[id]` detail) · `dinners` (+ `dinners/[id]`) · `crew` ([`CrewView`](components/CrewView.tsx)) · `photos` ([`PhotosView`](components/PhotosView.tsx)) · `pay` ([`PayView`](components/PayView.tsx)) |
| `/chat` | [`app/chat/page.tsx`](app/chat/page.tsx) | Resort chat ([`ChatView`](components/ChatView.tsx)), tied to identity |

**Posts feed** ([`PostsView`](components/PostsView.tsx)) supports `@mentions` in
**comments** as well as the existing post tagging — the comment box has inline
`@name` autocomplete over the whole member list, mentions persist in
`post_comment_mentions` (migration [`0022`](supabase/migrations/0022_post_comment_mentions.sql),
public-read like comments), and `@name` renders highlighted (shared
`MentionText` helper, mirrors the chat).

**Committee chat** ([`CommitteeChat`](components/CommitteeChat.tsx)) `@mentions`
are scoped to **that committee's roster only** — you can only tag people who can
see the room (Beautification members can tag Beautification members, etc.).
Messages can also be **edited or deleted within 24h** by their author (admins
anytime); delete is a **soft delete** — it stamps `committee_messages.deleted_at`
and the bubble (and any reply that quotes it) becomes a **"message deleted"**
tombstone for everyone, regardless of who removed it; edits stamp `edited_at` and
show a subtle "edited". The 24h-author / admin-anytime rule is enforced in RLS,
not just the UI (migration [`0023`](supabase/migrations/0023_committee_message_edit_delete.sql)).
| `/notifications` | [`app/notifications/page.tsx`](app/notifications/page.tsx) | **Activity** tab (bell icon) — a per-member Notifications feed ([`NotificationsView`](components/NotificationsView.tsx)). Members only |
| `/people` | [`app/people/page.tsx`](app/people/page.tsx) | **People** tab (👥, last slot — took Profile's old spot) — the member directory ([`PeopleDirectory`](components/PeopleDirectory.tsx)): everyone with an account, searchable, each with a quick Text / Call / pay bar + tap-through to their full profile ([`MemberSheet`](components/MemberSheet.tsx)), plus **email a group** ([`EmailMembersSection`](components/EmailMembersSection.tsx)) |
| `/profile` | [`app/profile/page.tsx`](app/profile/page.tsx) | Identity, email-alert opt-in, in-app notification prefs ([`NotifPrefs`](components/NotifPrefs.tsx)), admin alert + notification composers, sign out. **Not a tab** — reached via the profile photo in the top-left of the app header ([`AppHeader`](components/AppHeader.tsx)) |
| `/dining` | [`app/dining/page.tsx`](app/dining/page.tsx) | Dining + amenities (linked from Home, not a tab) |
| `/local-places` | [`app/local-places/page.tsx`](app/local-places/page.tsx) | **Local Places** — nearby businesses with quick Menu/Order/Call/Website links ([`LocalPlaceCard`](components/LocalPlaceCard.tsx)), data in [`lib/places.ts`](lib/places.ts); linked from Home. Inshalla hands off to the in-app `/tee-times` screen |
| `/events` | [`app/events/page.tsx`](app/events/page.tsx) | **Events** — the resort calendar + RSVP. Every upcoming gathering with a Going / Maybe / Can't-make control ([`AttendanceControl`](components/AttendanceControl.tsx)), a tap-through to who's coming + a per-day drill-down for Family Fest ([`EventSheet`](components/EventSheet.tsx)); admins create/edit ([`EventComposer`](components/EventComposer.tsx)). Linked from Home; nearest event is also spotlighted on Home ([`UpcomingEvents`](components/UpcomingEvents.tsx)). See **Resort events & attendance** |
| `/help` | [`app/help/page.tsx`](app/help/page.tsx) | **Help & how-to** — non-technical onboarding: what the app is, browse-vs-sign-in, "I didn't get my code" troubleshooting, add-to-home-screen ([`InstallButton`](components/InstallButton.tsx)), and a **text-size control** ([`TextSizeControl`](components/TextSizeControl.tsx)). Leads with a human escape hatch (text/email `HELP_CONTACT` in [`lib/help.ts`](lib/help.ts)). Linked from Profile + the sign-in sheet. Not a tab |

Bottom nav: [`components/TabBar.tsx`](components/TabBar.tsx) (the `TABS` array
is the single source of truth for routes + labels + icons): Home · Feed ·
Family Fest · Activity · **People**.

Top app chrome: [`components/AppHeader.tsx`](components/AppHeader.tsx) — a
persistent header (above the announcement banner + page content) with your
**profile photo in the top-left corner** (Facebook/X style; a generic "blank
profile" silhouette via [`Avatar`](components/Avatar.tsx) `fallback="icon"`
until you add a photo) linking to `/profile`, and the **MLR wordmark centered**
linking Home. Replaces the old Home-only wordmark header.

## Non-technical / accessibility UX

Built for a family of mixed ages, so the rough edges that stop the least
technical members are smoothed:

- **Sign-in (`SignInGate` in [`IdentityProvider`](components/IdentityProvider.tsx))** — passwordless email-OTP with a **"check your spam"** hint, a **Resend code** button (30s cooldown so taps can't trip Supabase's rate limit), plain-language error mapping (`friendlyAuthError`), and a "Need help signing in?" link to `/help`. Code input is 6 digits (matches Supabase's default).
- **Install** — [`InstallHint`](components/InstallHint.tsx) is the single install authority: the iOS first-run nag **plus** on-demand install via `requestInstall()` ([`lib/install.ts`](lib/install.ts)). On Android/desktop Chrome it fires the captured native `beforeinstallprompt`; on iOS it opens the Safari walkthrough. [`InstallButton`](components/InstallButton.tsx) (Home, Profile, Help) is the re-entry point — it self-hides once installed.
- **Welcome** — [`WelcomeCard`](components/WelcomeCard.tsx) shows once per device on Home, orienting newcomers to browse-first + no-password sign-in.
- **Text size + zoom** — [`TextSizeControl`](components/TextSizeControl.tsx) overrides the `<html>` rem root (17/19/21px); a boot script in [`layout.tsx`](app/layout.tsx) re-applies the saved choice before paint. Pinch-zoom is now allowed (viewport `userScalable: true`, was disabled). `body` uses `font-size: 1rem` so the override scales the whole app — **don't re-pin a px font-size on `body`/`html`** or you break it.
- **Sign-in walls** ([`Guard`](components/Guard.tsx), `CommitteeJoin`, `CommitteeChat`) carry a "just your name & email, no password" reassurance.

## Identity, admins & alerts

- **Identity (on-demand, not a gate)** — the whole app is **public to browse**.
  [`components/IdentityProvider.tsx`](components/IdentityProvider.tsx) only asks
  for name + email when you try to *do* something (post in chat, RSVP, …): those
  actions call `promptSignIn()`, which opens a dismissible sign-in sheet.
  `useIdentity()` exposes `{ user, isAdmin, updateUser, promptSignIn, signOut }`
  (`user` is `null` while browsing as a guest). Identity is stored in
  `localStorage`, no verification yet; at sign-in the guest opts in/out of email
  alerts.
- **Admins** — strictly `profiles.is_admin` in Supabase; the database is the
  **single source of truth** (there is no client allow-list — it could only grant
  UI the server won't honor). The first admin is bootstrapped once from the SQL
  editor; after that admins promote each other in-app. Admins see, in
  Profile → Admin: the alert composer
  ([`AdminAlertComposer`](components/AdminAlertComposer.tsx)), the **member
  directory** ([`AdminMembers`](components/AdminMembers.tsx)) — promote/remove-admin
  *and* permanently remove a member — and **recent sign-ins**
  ([`AdminSignins`](components/AdminSignins.tsx)). Clients can't write `is_admin`
  (column-level grant in `0001`, insert guard in `0010`); admin-gated SECURITY
  DEFINER functions back the rest: `admin_members()` + `set_admin()`
  ([`0008`](supabase/migrations/0008_admin_members.sql)), `delete_member()` (hard
  delete via `auth.users` cascade; can't delete yourself or an admin —
  [`0009`](supabase/migrations/0009_admin_remove_member.sql)), and
  `recent_signins()` (GoTrue audit log + IP, geolocated client-side —
  [`0011`](supabase/migrations/0011_admin_signin_log.sql)). Each section shows a
  "run the migration" hint until its function exists. Admins can also **view as**
  a member or guest ([`PreviewAs`](components/PreviewAs.tsx) + floating
  [`PreviewBanner`](components/PreviewBanner.tsx)) — a device-local, UI-only
  `previewMode` override in `IdentityProvider` that re-renders the app as that
  role (to check the privacy wall); it never touches the real Supabase session.
- **Announcement banner** — [`components/AnnouncementBanner.tsx`](components/AnnouncementBanner.tsx)
  shows notices at the top of the app (server-fed seed +
  admin-posted alerts), dismissible per-device. Admin alerts also **auto-expire**
  so they don't sit at the top forever: the composer
  ([`AdminAlertComposer`](components/AdminAlertComposer.tsx)) picks a window
  (default **6h**, up to **30 days**) → stamped onto `Announcement.expiresAt` /
  `announcements.expires_at`, and the banner hides any notice past its expiry
  (people can still dismiss sooner with ✕; expired local alerts are pruned from
  `localStorage` on load). Migration
  [`0022`](supabase/migrations/0022_announcement_default_expiry.sql) gives the
  column a server-side 6h default; seed/legacy rows with no expiry never auto-hide.
- **Privacy wall (guests vs members)** — the app is still browsable, but sensitive
  info is gated behind sign-in via [`components/Guard.tsx`](components/Guard.tsx) +
  [`lib/privacy.ts`](lib/privacy.ts): `SignInWall` (whole-screen gate — wraps
  **Posts** and **Pay**), `Protected` (inline gate for a phone/email/location —
  guests get a "🔒 Sign in" chip), and `PrivateName` (full name for members,
  **first name only** for guests). `useGuest()` returns `guest = isSupabaseConfigured && !user`,
  so with no backend the app stays fully open (we never lock everyone out of an
  app that can't sign in); during prerender `user` is null, so the static HTML
  ships the gated/guest view. Applied to: Posts, Pay/dues, MemberSheet
  (contact+pay), schedule/dinner/committee detail pages (locations, chef/lead/member
  contacts, "houses on crew"), FestStatus/FestWeek (today's locations + contacts),
  DinnerCrew, CrewView (household names), CommitteeJoin. ⚠️ **This is the UI layer
  only** — sensitive seed data still ships in the client bundle and Supabase
  posts/profiles are still public-read; the real hardening (gated server reads +
  RLS lockdown, keeping PII out of the bundle) is the planned next step.

## Family Fest season (the "one app" spine)

Both apps share a phase model so Family Fest behaves as a season of the resort,
not a separate app — no backend needed:

- [`lib/festSeason.ts`](lib/festSeason.ts) — pure `getFestSeason(start, end)` →
  `{ phase: "off-season" | "planning" | "live" | "wrap", isLive, isPlanning,
  isWrap, isTakeover, daysUntilStart, isSoon, dayNumber, totalDays, daysSinceEnd,
  wrapDaysLeft }`, plus `toISODate()` and the `PLANNING_LEAD_DAYS` (60) /
  `WRAP_TAIL_DAYS` (14) window constants. **Mirrored byte-for-byte in the
  `family-fest` repo** (like the EVENT/FAMILY_FEST seed data) — edit both.
- [`lib/useFestSeason.ts`](lib/useFestSeason.ts) — client hook; computes the
  phase **on the client** (returns `null` until mounted → no hydration mismatch)
  so the live week is correct on the static Pages build *and* Vercel. A
  build-time `new Date()` would freeze the phase at deploy.
- Consumers: [`FamilyFestSpotlight`](components/FamilyFestSpotlight.tsx) (home —
  quiet banner → planning partial-takeover → live takeover hero → wrap "post
  your photos"), [`FestStatus`](components/FestStatus.tsx) (hub — countdown →
  "Day n of N + Today at the Fest" → wrap photo nudge), and
  [`TabBar`](components/TabBar.tsx) (live dot on the Family Fest tab during
  live + wrap).
- Dates come from `FAMILY_FEST.startDate` / `.endDate` in `lib/data.ts`.
- The §0b full code merge is unchanged/deferred; this is the lighter-touch
  "feels like one app" layer that ships before the backend.

## Resort events & attendance

The resort calendar + a Facebook-style RSVP, backed by Supabase (migrations
[`0034`](supabase/migrations/0034_events.sql) `events` + admin RPCs,
[`0035`](supabase/migrations/0035_event_attendance.sql) `event_attendance` +
upsert RPC). Both tables are **public-read**; all writes go through
`security definer` RPCs (admins manage the calendar; a member writes only their
own RSVP) — the same shape as the cabin feature.

- **Events** are admin-managed DB rows merged with an in-code **seed**
  ([`RESORT_EVENTS`](lib/data.ts)) so the calendar has content out of the box.
  **Family Fest is deliberately NOT a DB row** — it's synthesized from
  `FAMILY_FEST` so its dates have one source of truth and stay tied to the season
  model. Merge + helpers live in [`lib/events.ts`](lib/events.ts); the shared data
  flow (load, realtime, optimistic RSVP, per-event summaries) is the `useEvents`
  hook in [`lib/hooks.ts`](lib/hooks.ts).
- **Attendance** keys on a **stable string event id** (the DB uuid, or a seed
  slug like `family-fest-2026`) — *not* a FK — so synthesized events carry RSVPs
  just like DB ones. `delete_event()` cleans up their rows by id.
- **Per-day drill-down:** multi-day events with `day_rsvp` (Family Fest) get an
  optional Mon–Fri picker; the `days` JSON map rolls up to the overall status —
  going at least one day reads as **Going** (`effectiveStatus()`).
- **Surfaces:** [`UpcomingEvents`](components/UpcomingEvents.tsx) spotlights the
  nearest event on Home (skips Family Fest while its own takeover spotlight is
  showing); [`/events`](app/events/page.tsx) is the full calendar.
  [`AttendanceControl`](components/AttendanceControl.tsx) /
  [`EventCard`](components/EventCard.tsx) /
  [`EventSheet`](components/EventSheet.tsx) /
  [`EventComposer`](components/EventComposer.tsx) reuse the existing sheet motion,
  Guard privacy wall (`PrivateName` masks guest names), and theme tokens.
- **Not in v1 (clean follow-ups):** new-event notifications + pre-event reminders
  (reuse `_notify` / `notif_types` / the mini push-sender, like cabin notifs); the
  Google-Calendar ICS feed (see Backend seams).

## Ask for Help (BETA)

A member who's **at the resort** posts a short request for a hand (moving logs,
setting up, a ride, supplies, or the rare 🚨 Urgent); members who opted into
**Willing to Help** *and* are also at the resort right now get an in-app
notification + phone push, can tap **On my way** (the only response), and see open
requests in a shared **log** ([`/help-requests`](app/help-requests/page.tsx) →
[`HelpRequestsView`](components/HelpRequestsView.tsx)). The requester says how many
people they need; once that many are on the way the request reads **✅ Covered** and
everyone eligible is told (so others don't bother). **Beta-gated** behind
`profiles.beta_tester` (entry: a self-hiding Home card
[`AskForHelpHomeCard`](components/AskForHelpHomeCard.tsx) + a Profile → Beta link;
the [`WillingToHelpToggle`](components/WillingToHelpToggle.tsx) opt-in lives there too).

- **Presence with no geolocation.** A PWA can't track location in the background,
  so "at the resort right now" is derived from data we already have: you're present
  if you're RSVP'd **going** to an event whose window **±2 days**
  (`EVENT_PRESENCE_GRACE_DAYS`, for early arrivals / lingering long weekends)
  includes today, **or** you have an **approved cabin stay** covering today. For
  day-RSVP events (Family Fest) on a real event day the per-day `days[today]` map is
  checked (a Mon–Wed attendee isn't pinged Thursday); on the ±2 grace shoulder days
  it falls back to "going at all" (lenient on purpose — better to over-ask than
  miss someone who's still around).
- **Targeting is client-snapshotted, server-resolved.** The client merges DB + seed
  events (Family Fest's dates live in code) to compute the live-event ids
  ([`helpTargeting`](lib/helpRequests.ts)) and passes them to `request_help`; the
  server resolves recipients via `_help_recipients` (willing + present + beta + the
  `help_request` notif pref) and re-checks the **requester** is present. It *trusts*
  the client's event-window snapshot — recomputing server-side would mean moving
  seed-event dates into the DB and would break the demo-date test override. That's an
  accepted beta trade-off; **GA hardening:** persist seed event windows + re-derive in
  the RPC (see the 0037 header).
- **Data flow** mirrors the cabin + events features: a public(member)-read table
  written only via SECURITY DEFINER RPCs (`request_help` → `(id, notified)`,
  `respond_to_help`, `withdraw_help`, `set_help_status`), AFTER-INSERT triggers that
  fan out via `_notify` (so it rides the in-app feed + the mini's push-sender once
  `help_request`/`help_response` are in `notif_types`/`push_types`/`PUSHABLE_FEED_TYPES`),
  a realtime [`useHelpRequests`](lib/hooks.ts) hook, and the
  [`AskForHelpSheet`](components/AskForHelpSheet.tsx) form (type · what · how many ·
  where + optional one-tap GPS pin · optional time · "notify everyone willing"
  escape hatch). Fulfillment is **race-safe** (conditional `update … where
  fulfilled_at is null` + `FOUND`). **Data model:** migration
  [`0037`](supabase/migrations/0037_help_requests.sql) (`profiles.willing_to_help`,
  `help_requests`, `help_responses`, the RPCs/triggers, + `help_request`/`help_response`
  added to `notif_types`/`push_types`). An open-request cap (10) is the only
  anti-spam guard for now.
- **Beta testing affordances** (migration [`0038`](supabase/migrations/0038_help_test_affordances.sql)):
  **admins bypass the requester presence gate** (post from anywhere to test/demo —
  the beta gate + recipient presence still apply, so use "Notify everyone willing"
  to reach people when off-season), and **beta-tester requesters get a self-ping**
  for their own request (`_notify` normally skips the actor) so it can be verified
  solo. Both fall away at GA (they key on `is_admin` / `beta_tester`).
- **GA plan — Urgent/SOS goes to EVERYONE.** While in beta the whole feature is
  beta-gated and routed only to willing + present members. **Once out of beta**, an
  **Urgent** request (`category = 'urgent'`) must alert **every member who has
  notifications on**, regardless of `willing_to_help` or presence — emergencies are
  for everyone. Non-urgent types keep the willing + present targeting. Implementation
  sketch: in `notif_on_help_request`, when `NEW.category = 'urgent'`, fan out to all
  members with `'help_request' = any(notif_types)` (skip the willing/present filter);
  otherwise use `_help_recipients` as today. (Deferred until GA — don't enable while
  beta-gated.)

## Backend seams (planned, not yet wired)

These are built UI-first with the swap point isolated to one module each:

| Feature | Seam today | Becomes |
|---|---|---|
| Google-Drive-fed announcements | [`lib/announcements.ts`](lib/announcements.ts) `getAnnouncements()` | server route reading a Drive file (API or published CSV/JSON), revalidated / webhook-pushed |
| Google-Calendar events feed | [`lib/events.ts`](lib/events.ts) `fetchGcalEvents()` (returns `[]`) | fetch + parse a **published Google Calendar ICS** (`NEXT_PUBLIC_GOOGLE_CALENDAR_ICS_URL`, no OAuth) → `ResortEvent[]` (`source: "gcal"`), merged in `fetchEvents()` |
| Email OTP / magic link | `IdentityProvider` sign-in | verify email before `setUser` |
| Shared chat | [`components/ChatView.tsx`](components/ChatView.tsx) (localStorage) | shared DB + realtime/poll |
| Admin alerts → broadcast | [`lib/localAnnouncements.ts`](lib/localAnnouncements.ts) | server validates admin, broadcasts, **emails opted-in guests**, web-push for Android |
| Email alerts opt-in | `user.emailAlerts` flag | mail provider (Resend/SendGrid) sends on alert |

A single backend (e.g. Supabase: email OTP auth + Postgres + realtime, or
Vercel Postgres/KV + Resend + web-push) can cover all of these.

**Push notifications (shipped).** Web push for chat messages + broadcast alerts,
on Android *and* iOS (iOS requires the app added to the Home Screen / standalone
PWA — iOS 16.4+). Pieces: a minimal [`public/sw.js`](public/sw.js) service worker
(push + notificationclick only, no caching), client helpers in
[`lib/push.ts`](lib/push.ts) (permission + `pushManager.subscribe` →
`push_subscriptions`), a per-user level in Profile → Notifications
([`PushToggle`](components/PushToggle.tsx): all / mentions / alerts / off, stored
as `profiles.push_level`), and the sender on the mini
([`media-server/push-sender.js`](media-server/push-sender.js)) that listens to
Supabase realtime and delivers via the `web-push` lib. **Env:**
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the app; `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
/ `VAPID_SUBJECT` (+ existing `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`) on the mini.
**Data model:** migration [`0019`](supabase/migrations/0019_push_notifications.sql)
adds `profiles.push_level` + the `push_subscriptions` table (RLS: own-rows). All
of it is dormant/no-op until the VAPID keys are set, so the app builds and runs
without them.

**In-app Notifications (the Activity tab).** A durable, Facebook-style feed of
everything that happened involving you — comments & reactions on your posts,
@mentions in posts/comments, @mentions in committee chat, new Feed posts,
committee approve/decline, **cabin-stay requests (admins) & decisions
(requester)**, and admin broadcasts. Every kind has its own on/off toggle in
Profile → Notifications (`profiles.notif_types`); the mini's push-sender checks
the same `notif_types` for cabin pushes, so one switch controls feed + push.
**Independent of push** (it
works even if the mini is down; the chat firehose stays out — only chat
@mentions land here). Pieces: the [`/notifications`](app/notifications/page.tsx)
route → [`NotificationsView`](components/NotificationsView.tsx); the bell tab +
live unread **badge** in [`TabBar`](components/TabBar.tsx) via
[`useUnreadNotifications`](lib/hooks.ts); per-member kind prefs
([`NotifPrefs`](components/NotifPrefs.tsx) → `profiles.notif_types`); and an admin
sender ([`AdminNotificationComposer`](components/AdminNotificationComposer.tsx) →
`send_broadcast_notification`) that targets **Everyone / Beta testers / Admins**
(with an optional banner mirror for Everyone). **Read model:** `seen_at` drives
the badge (opening the tab clears it), `read_at` drives per-item bold, `expires_at`
drops an item from the badge while keeping it in the list. **Beta Tester** is a new
admin-assigned role (`profiles.beta_tester`, toggled in
[`AdminMembers`](components/AdminMembers.tsx)) used to dry-run notifications.
**Data model:** [`0029`](supabase/migrations/0029_beta_tester_and_notif_prefs.sql)
(`beta_tester`, `notif_types`, `set_beta_tester`) +
[`0030`](supabase/migrations/0030_notifications_feed.sql) (the `notifications`
table, fan-out triggers on the source tables, and the `mark_*` /
`send_broadcast_notification` RPCs). Rows are written **only** by SECURITY DEFINER
triggers/RPCs (no client insert); members can read/dismiss their own.

**Mac-mini media server** ([`media-server/`](media-server/)) also now
**transcodes uploaded videos** to web-friendly ≤1080p H.264 MP4 via `ffmpeg`
([`transcode.js`](media-server/transcode.js)) — photos are left full quality —
and hosts the optional [`alert-mailer.js`](media-server/alert-mailer.js) +
[`push-sender.js`](media-server/push-sender.js) side jobs alongside uploads.

## AI Assistant ("Ask MLR")

A signed-in convenience bot (floating ✨ button → [`AssistantButton`](components/AssistantButton.tsx)
→ [`AssistantChat`](components/AssistantChat.tsx) on `Sheet`) that answers
questions from app data the member can already see — schedule, who's in charge,
contacts, locations, "where do I find this?". **Off by default for everyone.**
The button shows only when you're a **Beta Tester** (`profiles.beta_tester`) **and**
you've turned it on in Profile → Beta features ([`AssistantToggle`](components/AssistantToggle.tsx),
a per-device localStorage switch via [`lib/assistantToggle.ts`](lib/assistantToggle.ts),
default off; the toggle itself only renders for beta testers). **Two hard
guarantees:** (1) **signed-in only** (beta implies signed-in; `askAssistant`
refuses guests; the future server route re-checks the Supabase token), and (2)
**chats are never a source** — resort/committee chat are absent from retrieval by design;
**posts** (public to any signed-in member) are the only sanctioned social source
(allow-listed, not yet wired). So the privacy bar is just "signed-in + no chats"
— it does *not* depend on the larger RLS hardening.

Pipeline lives in [`lib/assistant/`](lib/assistant/): `index.ts` (`askAssistant`
orchestrator — sign-in gate, 500-char cap), `intent.ts` (pure `classifyIntent` /
`resolveDay`), `retrieval.ts` (the **allow-list** over static `lib/data.ts` —
`SOURCE_ALLOWLIST`, chats excluded), `generate.ts` (the single swappable model
seam + system prompt). It runs **client-side today** (all v1 data is static, so
nothing new is exposed) and drops into a `POST /api/assistant` route unchanged.

**Model is swappable behind `generateAssistantAnswer()`.** With none wired it
answers via a deterministic *grounded stub* (no invention; assembled from the
retrieved records). Otherwise it points `ASSISTANT_FM_URL` at **Apple Foundation
Models** running in a small Swift service on the Mac mini
([`media-server/fm-service/`](media-server/fm-service/)) — Apple's models only run
on Apple devices, so generation lives on the mini while orchestration stays on
Vercel (contract: `POST {system,question,context} → {answer,model}`). On **macOS
27** the service is wired to prefer Apple's **Private Cloud Compute** model (far
more capable, ~32K context) with on-device fallback, decided by a startup probe.
⚠️ But PCC *inference* is entitlement-gated and **currently not attainable**: it
fails with `ModelManagerError 1046`; the only third-party capability is the
**request-only** `com.apple.developer.foundation-model-adapter` (for custom
adapters), a **free Personal Team can't get it** (Xcode provisioning rejects it
verbatim), and even a legit Xcode dev signature (`get-task-allow`) doesn't bypass
the gate. Enabling it would need a paid membership + an Apple-approved entitlement.
So the bot runs **on-device** today; the probe auto-switches to PCC if it ever
becomes reachable. Full findings in [`media-server/fm-service/README.md`](media-server/fm-service/README.md).
Also note: `swift build` on the current CLT beta needs a `DYLD_FALLBACK_FRAMEWORK_PATH`
workaround (README). The `/api/assistant` route ships **Vercel-only** (a POST
handler breaks the Pages `output: export`); its wrapper + env vars are in
[`docs/ai-assistant.md`](docs/ai-assistant.md).

## Conventions

- **Theme** — all colors are CSS variables in the `@theme` block of
  [`app/globals.css`](app/globals.css). Tailwind v4 turns each `--color-*` into
  `bg-*` / `text-*` / `ring-*` / `border-*` utilities. Never hard-code hex in
  components; add or edit a token. Palette: `--color-primary` = forest green
  (`#15503a`, the logo), `--color-accent` = vintage chestnut, on a near-white
  page. The resort wordmark uses `.font-script` (Yellowtail, via next/font).
  `--color-fest` is the Family Fest heraldic wine for fest-branded accents
  *outside* `.ff-section` (e.g. the TabBar's Family Fest tab + live dot).
  - ⚠️ **LIGHT MODE ONLY — never add a dark theme.** And **never** use a dark
    translucent surface tint (`bg-black/NN`, `bg-zinc-*/NN`) as a card/panel bg —
    it goes muddy grey on light (a recurring issue across the author's apps).
    Translucent layers stack LIGHT; `bg-black/NN` is OK only as a modal scrim.
- **Cross-nav** — the **Family Fest** bottom tab → `/family-fest` overview, then
  the in-section [`FamilyFestNav`](components/FamilyFestNav.tsx) sub-nav switches
  between Schedule / Dinners / Crew / Photos / Pay. All internal routes — no
  external hop. (The §0b merge is now done; identity stays per-app localStorage
  until the Supabase phase.)
- **Family Fest theme scoping** — the FF section's parchment/Renaissance palette
  + Cinzel serif are scoped to `.ff-section` (see `app/globals.css` and
  [`app/family-fest/layout.tsx`](app/family-fest/layout.tsx)): the wrapper
  re-declares the `--color-*` / `--font-display` variables that Tailwind's
  utilities read, so only that subtree changes. Don't hard-code hex.
- **Sheets/overlays** — build on [`components/Sheet.tsx`](components/Sheet.tsx)
  (scrim + slide-up panel + grab handle + close button + safe-area footer; also
  exports `SectionLabel` and the `FIELD` input class) paired with
  `useSheetDismiss` in [`lib/hooks.ts`](lib/hooks.ts) (close animation + Escape
  + reduce-motion). `EventSheet` / `CabinRequestSheet` / `EventComposer` are the
  reference consumers; `Lightbox` / `AvatarCropper` use just the hook
  (`MemberSheet` keeps its own drag-to-dismiss physics).
- **Loading states** — async pages show pulsing card placeholders
  ([`components/Skeleton.tsx`](components/Skeleton.tsx) `SkeletonList`), not a
  bare "Loading…" line.
- **Formatting** — dates/numbers/currency go through
  [`lib/format.ts`](lib/format.ts). Add new formatters there.
- **`@/*`** path alias maps to repo root (see `tsconfig.json`).
- **`npm install`** relies on `.npmrc` (`legacy-peer-deps=true`).
- **`npm run typecheck`** (`tsc --noEmit`) is the static check — there's no
  ESLint setup (`next lint` was removed in Next 16).
- Client components (`TabBar`, `InstallHint`) carry `"use client"`.

## Keep this current

When you add a route, dependency, env var, or change the data model, update
this file and `README.md` in the same commit. Doc drift is the only failure
mode that makes these files harmful.
