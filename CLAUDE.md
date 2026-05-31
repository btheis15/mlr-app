# CLAUDE.md — mlr-app

Entry point for Claude/AI sessions on this repo. Read this first.

## What this repo is

A **Next.js 16 + React 19 + Tailwind v4 PWA** for **Muskellunge Lake Resort
(MLR)** — the year-round resort app. Mobile-first, vertical, dark theme. Same
conventions as the author's other apps (`stock-game`, `innjoy-mobile`): App
Router, CSS-variable theme tokens, bottom `TabBar`, iOS install hint, Vercel
auto-deploy on push to `main`.

MLR is the **umbrella app**. **Family Fest** (the one-week annual gathering) is
embedded as a hub at `/family-fest` that mirrors the event highlights and links
out to the deep standalone `family-fest` app — so the two read as "two apps in
one" without sharing a backend yet.

**Data model:** client-only for now. Resort content (activities, dining,
amenities, Family Fest highlights) is static in [`lib/data.ts`](lib/data.ts);
types in [`lib/types.ts`](lib/types.ts). Identity, chat, alert dismissals, and
admin-posted alerts persist per-device in `localStorage`. Several features are
deliberately scaffolded with a clean seam for a backend — see **Backend seams**.

## The tabs

| Route | File | Status |
|---|---|---|
| `/` | [`app/page.tsx`](app/page.tsx) | Home — Family Fest banner, nav, amenities, front-desk call |
| `/activities` | [`app/activities/page.tsx`](app/activities/page.tsx) | Resort activities grouped by category |
| `/family-fest` | [`app/family-fest/page.tsx`](app/family-fest/page.tsx) | Embedded Family Fest hub (countdown + highlights + link out) |
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
  (`user` is `null` while browsing as a guest); at sign-in the guest opts in/out
  of email alerts.
  - **Auth is now real (passwordless email-OTP), env-gated.** When
    [`lib/supabase.ts`](lib/supabase.ts) finds `NEXT_PUBLIC_SUPABASE_URL` /
    `_ANON_KEY`, `promptSignIn()` runs Supabase email-OTP (email → 6-digit code →
    persisted session) and hydrates `user` from the shared `profiles` row — the
    SAME account as `family-fest` (one project for both). With no env it falls
    back to the legacy on-device (localStorage) sheet, unchanged. The public
    `useIdentity()` API is identical in both modes, so no callers changed.
  - `isAdmin` prefers the non-spoofable `profiles.is_admin` column, falling back
    to the `ADMIN_EMAILS` allow-list pre-backend. See README "Activate login" +
    [`supabase/schema.sql`](supabase/schema.sql).
- **Admins** — allow-list of emails in [`lib/data.ts`](lib/data.ts)
  (`ADMIN_EMAILS` / `isAdmin`). Only admins see the alert composer
  ([`components/AdminAlertComposer.tsx`](components/AdminAlertComposer.tsx)).
- **Announcement banner** — [`components/AnnouncementBanner.tsx`](components/AnnouncementBanner.tsx)
  shows notices at the top of the app (server-fed seed +
  admin-posted local alerts), dismissible per-device.

## Backend seams (planned, not yet wired)

These are built UI-first with the swap point isolated to one module each:

| Feature | Seam today | Becomes |
|---|---|---|
| Google-Drive-fed announcements | [`lib/announcements.ts`](lib/announcements.ts) `getAnnouncements()` | server route reading a Drive file (API or published CSV/JSON), revalidated / webhook-pushed |
| Email OTP / magic link | ✅ **WIRED** — `IdentityProvider` + [`lib/supabase.ts`](lib/supabase.ts), env-gated | just add a Supabase project + env vars (README "Activate login") |
| Shared chat | [`components/ChatView.tsx`](components/ChatView.tsx) (localStorage) | shared DB + realtime/poll |
| Admin alerts → broadcast | [`lib/localAnnouncements.ts`](lib/localAnnouncements.ts) | server validates admin, broadcasts, **emails opted-in guests**, web-push for Android |
| Email alerts opt-in | `user.emailAlerts` flag | mail provider (Resend/SendGrid) sends on alert |

A single backend (e.g. Supabase: email OTP auth + Postgres + realtime, or
Vercel Postgres/KV + Resend + web-push) can cover all of these.

## Conventions

- **Theme** — all colors are CSS variables in the `@theme` block of
  [`app/globals.css`](app/globals.css). Tailwind v4 turns each `--color-*` into
  `bg-*` / `text-*` / `ring-*` / `border-*` utilities. Never hard-code hex in
  components; add or edit a token.
- **Formatting** — dates/numbers/currency go through
  [`lib/format.ts`](lib/format.ts). Add new formatters there.
- **`@/*`** path alias maps to repo root (see `tsconfig.json`).
- **`npm install`** relies on `.npmrc` (`legacy-peer-deps=true`).
- Client components (`TabBar`, `InstallHint`) carry `"use client"`.

## Keep this current

When you add a route, dependency, env var, or change the data model, update
this file and `README.md` in the same commit. Doc drift is the only failure
mode that makes these files harmful.
