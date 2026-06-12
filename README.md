# Muskellunge Lake Resort (MLR)

The year-round resort app — activities, dining, an embedded Family Fest hub,
resort chat, and a signed-in **"Ask MLR" AI assistant** (answers from your resort
info — never private chats; see [`docs/ai-assistant.md`](docs/ai-assistant.md)) —
installable to your phone's home screen. **Light mode only**, built
around the official **forest-green** Muskellunge Lake Resort logo (cabin in the
pines, EST 1987) with vintage heritage from the original resort (Leo & Dorothy
Theis · Fishing · Hunting · Boating · Tomahawk, WI).

> **Live:** https://mlr-app-omega.vercel.app (Vercel) · https://btheis15.github.io/mlr-app/ (Pages)
>
> **Status: read-only launch.** The whole browse experience is live (Home,
> Activities, Dining & amenities, the Family Fest hub, reading Chat) against seed
> data in [`lib/data.ts`](lib/data.ts). Interactive features (sign-in, chat
> posting, RSVP, admin alerts) are gated behind a "coming soon" via the
> `READ_ONLY` flag in [`lib/features.ts`](lib/features.ts) until the Supabase
> backend lands — see [CLAUDE.md](./CLAUDE.md) "Backend seams" and
> [NEXT-STEPS.md](./NEXT-STEPS.md).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbtheis15%2Fmlr-app)

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind v4** — light-mode-only theme tokens (forest-green primary) as CSS
  variables via `@theme` in [`app/globals.css`](app/globals.css); brush-script
  wordmark (Yellowtail) via `next/font`
- **Framer Motion** for interactions
- **PWA** — standalone manifest, "Add to Home Screen" hint on iOS
- **Hosting** — live on **Vercel** + **GitHub Pages** (Pages auto-deploys on
  push to `main`; Vercel is currently manual via `vercel --prod`)

## Quick start

```bash
npm install            # .npmrc already sets legacy-peer-deps
npm run dev            # http://localhost:3000
```

## Project layout

```
app/            App Router routes (page.tsx per tab) + layout + globals.css
components/     TabBar, InstallHint, shared UI
lib/            format.ts and other pure helpers
public/         manifest.webmanifest, icon.svg
```

## Where to make changes

- **Colors / theme** — the `@theme` block in [`app/globals.css`](app/globals.css).
  Editing a token (e.g. `--color-primary`) flows through every `bg-*`/`text-*`
  utility automatically.
- **Navigation** — the `TABS` array in [`components/TabBar.tsx`](components/TabBar.tsx).
- **A tab's content** — its `app/<tab>/page.tsx`.
- **Local Places** — the nearby-businesses list at `/local-places` (linked from
  Home); add or edit spots in [`lib/places.ts`](lib/places.ts) and the page
  renders them. Inshalla hands off to the in-app `/tee-times` screen.
- **Events & attendance** — the resort calendar + RSVP at `/events`, with the
  nearest event spotlighted on Home. Admins create events; members tap
  Going / Maybe / Can't make (Family Fest has an optional per-day picker). Data
  flow is [`lib/events.ts`](lib/events.ts) + the `useEvents` hook in
  [`lib/hooks.ts`](lib/hooks.ts); backed by Supabase migrations
  [`0034_events.sql`](supabase/migrations/0034_events.sql) +
  [`0035_event_attendance.sql`](supabase/migrations/0035_event_attendance.sql)
  (run them in the Supabase SQL editor). See CLAUDE.md → **Resort events &
  attendance**.
- **Ask for Help (BETA)** — at `/help-requests`, a member who's at the resort posts
  a short request for a hand (moving, setup, a ride, supplies, or 🚨 urgent); willing
  members who are *also* at the resort get a push, tap **On my way**, and the request
  reads **✅ Covered** once enough are coming. "At the resort" is derived from event
  attendance (±2 days) / approved cabin stays — no geolocation. Beta-gated behind
  `profiles.beta_tester`. Migration
  [`0037_help_requests.sql`](supabase/migrations/0037_help_requests.sql);
  [`lib/helpRequests.ts`](lib/helpRequests.ts) + `useHelpRequests`. See CLAUDE.md →
  **Ask for Help (BETA)**.
- **Content safeguards (feed moderation)** — layered checks on the Posts feed so
  sensitive/inappropriate/illegal content doesn't sit in front of the family.
  The mini rejects non-image/video uploads by magic bytes; an admin-managed
  blocklist + member **Report** auto-hold flagged posts/comments for an admin
  review queue (Profile → Admin → Content review); on-device Apple nudity/text
  checks on the mini are the planned next layer. Migration
  [`0040_content_moderation.sql`](supabase/migrations/0040_content_moderation.sql);
  [`lib/moderation.ts`](lib/moderation.ts). Full writeup in
  [`docs/content-moderation.md`](docs/content-moderation.md) and CLAUDE.md →
  **Content safeguards**.

See [CLAUDE.md](./CLAUDE.md) for the operating manual for AI sessions.
