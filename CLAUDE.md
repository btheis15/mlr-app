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
| `/` | [`app/page.tsx`](app/page.tsx) | Home — **kept lean**: Family Fest season spotlight ([`FamilyFestSpotlight`](components/FamilyFestSpotlight.tsx)), one Dining link (the only non-tab destination — no cards that duplicate the tabs), front-desk call, one-line heritage |
| `/activities` | [`app/activities/page.tsx`](app/activities/page.tsx) | Resort activities grouped by category |
| `/family-fest` | [`app/family-fest/`](app/family-fest/) | **Family Fest section** (its own `.ff-section` theme + [`FamilyFestNav`](components/FamilyFestNav.tsx) sub-nav). Overview ([`page.tsx`](app/family-fest/page.tsx): poster + [`FestStatus`](components/FestStatus.tsx) + next-up) · `schedule` (+ anytime [`THINGS_TO_DO`](lib/data.ts) & `schedule/[id]` detail) · `dinners` (+ `dinners/[id]`) · `crew` ([`CrewView`](components/CrewView.tsx)) · `photos` ([`PhotosView`](components/PhotosView.tsx)) · `pay` ([`PayView`](components/PayView.tsx)) |
| `/chat` | [`app/chat/page.tsx`](app/chat/page.tsx) | Resort chat ([`ChatView`](components/ChatView.tsx)), tied to identity |
| `/profile` | [`app/profile/page.tsx`](app/profile/page.tsx) | Identity, email-alert opt-in, admin alert composer, sign out |
| `/dining` | [`app/dining/page.tsx`](app/dining/page.tsx) | Dining + amenities (linked from Home, not a tab) |

Bottom nav: [`components/TabBar.tsx`](components/TabBar.tsx) (the `TABS` array
is the single source of truth for routes + labels + icons).

## Identity, admins & alerts

- **Identity (on-demand, not a gate)** — the whole app is **public to browse**.
  [`components/IdentityProvider.tsx`](components/IdentityProvider.tsx) only asks
  for name + email when you try to *do* something (post in chat, RSVP, …): those
  actions call `promptSignIn()`, which opens a dismissible sign-in sheet.
  `useIdentity()` exposes `{ user, isAdmin, updateUser, promptSignIn, signOut }`
  (`user` is `null` while browsing as a guest). Identity is stored in
  `localStorage`, no verification yet; at sign-in the guest opts in/out of email
  alerts.
- **Admins** — allow-list of emails in [`lib/data.ts`](lib/data.ts)
  (`ADMIN_EMAILS` / `isAdmin`). Only admins see the alert composer
  ([`components/AdminAlertComposer.tsx`](components/AdminAlertComposer.tsx)).
- **Announcement banner** — [`components/AnnouncementBanner.tsx`](components/AnnouncementBanner.tsx)
  shows notices at the top of the app (server-fed seed +
  admin-posted local alerts), dismissible per-device.
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

## Backend seams (planned, not yet wired)

These are built UI-first with the swap point isolated to one module each:

| Feature | Seam today | Becomes |
|---|---|---|
| Google-Drive-fed announcements | [`lib/announcements.ts`](lib/announcements.ts) `getAnnouncements()` | server route reading a Drive file (API or published CSV/JSON), revalidated / webhook-pushed |
| Email OTP / magic link | `IdentityProvider` sign-in | verify email before `setUser` |
| Shared chat | [`components/ChatView.tsx`](components/ChatView.tsx) (localStorage) | shared DB + realtime/poll |
| Admin alerts → broadcast | [`lib/localAnnouncements.ts`](lib/localAnnouncements.ts) | server validates admin, broadcasts, **emails opted-in guests**, web-push for Android |
| Email alerts opt-in | `user.emailAlerts` flag | mail provider (Resend/SendGrid) sends on alert |

A single backend (e.g. Supabase: email OTP auth + Postgres + realtime, or
Vercel Postgres/KV + Resend + web-push) can cover all of these.

## Conventions

- **Theme** — all colors are CSS variables in the `@theme` block of
  [`app/globals.css`](app/globals.css). Tailwind v4 turns each `--color-*` into
  `bg-*` / `text-*` / `ring-*` / `border-*` utilities. Never hard-code hex in
  components; add or edit a token. Palette: `--color-primary` = forest green
  (`#15503a`, the logo), `--color-accent` = vintage chestnut, on a near-white
  page. The resort wordmark uses `.font-script` (Yellowtail, via next/font).
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
- **Formatting** — dates/numbers/currency go through
  [`lib/format.ts`](lib/format.ts). Add new formatters there.
- **`@/*`** path alias maps to repo root (see `tsconfig.json`).
- **`npm install`** relies on `.npmrc` (`legacy-peer-deps=true`).
- Client components (`TabBar`, `InstallHint`) carry `"use client"`.

## Keep this current

When you add a route, dependency, env var, or change the data model, update
this file and `README.md` in the same commit. Doc drift is the only failure
mode that makes these files harmful.
