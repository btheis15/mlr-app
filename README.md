# MLR App

A mobile-first PWA scaffold, installable to your phone's home screen.

> **Status:** fresh scaffold. The stack, navigation, theme, and PWA plumbing
> are in place; the feature tabs (Activity / Profile) are placeholders waiting
> on the real product definition. (What is "MLR"? Tell Claude and the features
> get built out.)

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

See [CLAUDE.md](./CLAUDE.md) for the operating manual for AI sessions.
