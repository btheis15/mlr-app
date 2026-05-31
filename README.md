# Muskellunge Lake Resort (MLR)

The year-round resort app — activities, dining, an embedded Family Fest hub, and
resort chat — installable to your phone's home screen.

> **Status:** v1. Home, Activities, Dining & amenities, an embedded Family Fest
> hub, and resort Chat are wired up against seed data in
> [`lib/data.ts`](lib/data.ts). The whole app is public to browse; a name +
> email is only requested when you act (post in chat, RSVP). An admin-only alert
> composer and a top-of-app announcement banner are in place.
> Several pieces are deliberately scaffolded with a clean backend seam — see
> [CLAUDE.md](./CLAUDE.md) "Backend seams" (Drive-fed alerts, email OTP, shared
> chat, email/Android-push alerts).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbtheis15%2Fmlr-app)

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind v4** (theme tokens as CSS variables via `@theme` in
  [`app/globals.css`](app/globals.css))
- **Framer Motion** for interactions
- **PWA** — standalone manifest, "Add to Home Screen" hint on iOS
- **Vercel** — auto-deploy on push to `main`

## Quick start

```bash
npm install            # .npmrc already sets legacy-peer-deps
npm run dev            # http://localhost:3000
```

## Activate login (Supabase email-OTP) — ~4 steps

Passwordless email-code auth is **wired but dormant** until you point it at a
Supabase project. The app builds and runs without it (falling back to on-device
identity), so this is optional to get going but required for real, verified,
cross-device accounts. **Use ONE project for both `mlr-app` and `family-fest`**
so everyone is a single shared account (see [NEXT-STEPS.md](./NEXT-STEPS.md) §3).

1. **Create one Supabase project** → Project Settings → API → copy the
   **Project URL** and **anon public key**.
2. **Run the schema:** SQL Editor → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
3. **Set env vars** in *both* repos:
   - Local: `cp .env.local.example .env.local` and fill in the two values.
   - CI/Pages: repo **Settings → Secrets and variables → Actions → Variables** →
     add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same
     values in both repos). The build reads these (see `.github/workflows/pages.yml`).
4. **(Recommended) Free SMTP:** Supabase's built-in code email is rate-limited.
   Auth → Email → plug in Resend (free 3k/mo) or Gmail SMTP so codes always land.

That's it — `signInWithOtp` / `verifyOtp` run client-side, so no server is
needed on GitHub Pages. Make yourself an admin: after signing in once, set
`is_admin = true` on your row in the `profiles` table.

## Project layout

```
app/            App Router routes (page.tsx per tab) + layout + globals.css
components/     TabBar, InstallHint, IdentityProvider, shared UI
lib/            supabase.ts (shared client), format.ts, data.ts, types.ts
supabase/       schema.sql — run once in the shared project
public/         manifest.webmanifest, icon.svg
```

## Where to make changes

- **Colors / theme** — the `@theme` block in [`app/globals.css`](app/globals.css).
  Editing a token (e.g. `--color-primary`) flows through every `bg-*`/`text-*`
  utility automatically.
- **Navigation** — the `TABS` array in [`components/TabBar.tsx`](components/TabBar.tsx).
- **A tab's content** — its `app/<tab>/page.tsx`.

See [CLAUDE.md](./CLAUDE.md) for the operating manual for AI sessions.
