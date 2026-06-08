# Site assets

Static images and graphics that are part of the app's *chrome* — cover photos,
section headers, banners — as opposed to member-generated **Feed posts / chat
media** (those live under `../../media/` and are served at `/f`).

Keeping them here means:

- they live on the Mac mini (free) instead of the Next.js bundle or Supabase,
- they're version-controlled with the repo (so they're backed up via git), and
- the `media/` tree stays exclusively member uploads — no clutter.

## Serving

Everything in `media-server/assets/` is served at **`/assets/...`** with a
long cache. So a file here at `site/family-fest-2026.jpg` is reachable at:

```
https://brians-mac-mini.tail49943c.ts.net/assets/site/family-fest-2026.jpg
```

In the app, build the URL from `MEDIA_URL` (see `lib/media.ts`):

```ts
`${MEDIA_URL}/assets/site/family-fest-2026.jpg`
```

## Adding / replacing an asset

1. Drop the file in this folder (e.g. `family-fest-2026.jpg`).
2. Commit it (it's small + repo-tracked, that's the backup).
3. Reference it from the app via `${MEDIA_URL}/assets/site/<name>`.

No server restart needed — `express.static` picks up new files immediately.

## Current files

- `family-fest-2026.jpg` — Family Fest cover photo (shown atop `/family-fest`).
