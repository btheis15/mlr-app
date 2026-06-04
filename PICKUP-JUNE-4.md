# 📌 PICK UP HERE — handoff from the June 4 (2026) session

**This is a one-time "pick up where we left off" file.** It's safe to delete once
you've worked through it. If you're a fresh Claude session: read this first, then
`CLAUDE.md` for repo conventions. Everything below is already **merged to `main`**
— the code is done; what's left is **deploy/config steps the repo can't do for
you** (installing tools, generating secret keys, running a migration).

---

## TL;DR — what shipped this session (all merged to `main`)

1. **Chat UX fixes** (PRs #97–#99) — stopped iOS zoom-on-tap, pinned the composer
   above the keyboard, hid the tab bar while typing, killed the lock-icon flash
   when switching rooms, fixed the clipped composer placeholder + auto-grow.
   *(These are live, nothing to do.)*
2. **Video transcoding on the Mac mini** (PR #100) — uploaded videos are
   normalized to web-friendly ≤1080p H.264 MP4. **Needs `ffmpeg` installed on the
   mini to actually run** (see below). Photos are left full quality.
3. **Web push notifications** (PR #101) — Android + iOS (iOS needs the app added
   to the Home Screen). Per-user level in Profile → Notifications
   (Everything / Mentions & replies / Alerts only / Off). **Dormant until you run
   the migration + set VAPID keys** (see below).

Work was done on branch `claude/text-app-ui-experience-JNw6D`, all squash-merged
to `main`. Nothing is pending in a branch.

---

## ✅ DO THIS — checklist

### A. Supabase (run the SQL) — do this FIRST
The only new migration this session is **`supabase/migrations/0019_push_notifications.sql`**.
Open Supabase → **SQL Editor**, paste the block below, run it. (Assumes your
project is already up to migration `0018`, which it is if the app currently works.)

```sql
-- 0019_push_notifications.sql — per-user push level + per-device subscriptions.
alter table public.profiles
  add column if not exists push_level text not null default 'off'
  check (push_level in ('all', 'mentions', 'alerts', 'off'));

grant update (push_level) on public.profiles to authenticated;

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_sub_select on public.push_subscriptions;
create policy push_sub_select on public.push_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists push_sub_insert on public.push_subscriptions;
create policy push_sub_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());
drop policy if exists push_sub_update on public.push_subscriptions;
create policy push_sub_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_sub_delete on public.push_subscriptions;
create policy push_sub_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());
```

- [ ] Ran `0019` in the Supabase SQL editor.
- [ ] (If push events don't arrive later) Confirm **Realtime** is enabled for the
  `committee_messages` and `announcements` tables (Database → Replication /
  Publications). They should already be on — the chat + alert mailer use them.

> Note: the SQL above is the exact contents of `supabase/migrations/0019_push_notifications.sql` in this repo — both are kept in sync, embedded here so you don't have to hunt for the file.

### B. Mac mini — pull, install tools, restart
SSH/onto the mini, in the `mlr-app` repo:

```bash
cd ~/mlr-app                 # or wherever the repo lives on the mini
git pull                     # gets transcode.js, push-sender.js, new deps

brew install ffmpeg          # one-time — REQUIRED for video transcoding

cd media-server
npm install                  # installs the new "web-push" dependency

# Generate the push (VAPID) key pair — do this ONCE, save the output:
npx web-push generate-vapid-keys
#   → prints a Public Key and a Private Key. Keep them.
```

- [ ] `git pull` on the mini
- [ ] `brew install ffmpeg`
- [ ] `npm install` in `media-server`
- [ ] generated VAPID keys (saved both public + private)

### C. Mac mini — edit `media-server/.env`
Add/confirm these (see `media-server/.env.example` for the annotated versions):

```
# already there for uploads:
SUPABASE_URL=https://vrksrpzlslrcjvbzchfg.supabase.co

# REQUIRED for push (the mailer may already have set the service role key):
SUPABASE_SERVICE_ROLE_KEY=<your service role key — mini ONLY, never in the app>

# push (from `npx web-push generate-vapid-keys`):
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:alerts@yourdomain.com
APP_URL=https://mlr-app-omega.vercel.app
```

Then **restart the media server**. On startup it should log:
- `video      : transcoding ON (H.264 MP4, ≤1920px, crf 20)`  ← ffmpeg found
- `[push] listening (chat messages + alerts)`                 ← push live

If you instead see `ffmpeg/ffprobe not found` → step B's `brew install` didn't
take. If you see `[push] dormant` → a VAPID/service-role var is missing.

- [ ] `.env` updated with VAPID + service role + APP_URL
- [ ] media server restarted, startup log shows transcoding ON + push listening

### D. App (Vercel) — add the public key
The **public** VAPID key must also live in the app (it's safe to expose):

- [ ] In Vercel → project `mlr-app` → Settings → Environment Variables, add:
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = **the same public key** from step B.
- [ ] Redeploy the app (Vercel → Deployments → redeploy, or push any commit).

⚠️ The public key in Vercel **must match** `VAPID_PUBLIC_KEY` on the mini, or push
subscriptions will fail silently.

### E. Phones — turn it on
- [ ] On each phone: open the app in the browser → **Share → Add to Home Screen**
  (REQUIRED on iPhone for push to work at all; recommended on Android too — it
  also removes the Safari keyboard bar and makes the whole app feel native).
- [ ] Open the installed app → **Profile → Notifications** → pick a level
  (Everything / Mentions & replies / Alerts only). Allow the permission prompt.
- [ ] Test: have someone post a chat message in a committee you're in (or post a
  broadcast alert) → you should get a notification with the MLR logo that opens
  the app to that room when tapped.

---

## 🗺️ File map (so you don't have to hunt)

**Push notifications**
- `supabase/migrations/0019_push_notifications.sql` — the migration (run in Supabase)
- `public/sw.js` — service worker (push + click only; no caching)
- `lib/push.ts` — client: permission, subscribe, save/remove subscription
- `components/PushToggle.tsx` — the Profile level picker UI
- `app/profile/page.tsx` — renders `<PushToggle/>` in the Notifications section
- `components/IdentityProvider.tsx` — `pushLevel` loaded/saved on `profiles`
- `lib/types.ts` — `User.pushLevel` + `PushLevel` type
- `media-server/push-sender.js` — the mini sender (realtime → web-push)
- `media-server/.env.example` — annotated env (VAPID block)

**Video transcoding**
- `media-server/transcode.js` — ffmpeg normalize to ≤1080p H.264 MP4
- `media-server/server.js` — calls it in `/upload`; starts push-sender + mailer
- `media-server/README.md` — deploy notes for both
- `media-server/.env.example` — `VIDEO_*` tuning knobs

**Reference:** `CLAUDE.md` (repo conventions + a "Push notifications (shipped)"
and transcoding section under *Backend seams*).

---

## ⏳ Open decisions / things we deferred (ask Brian)

1. **Photo quality (Brian leans toward NOT compressing).** The app currently
   downscales photos client-side to ~1920px @ JPEG 0.82 in
   `lib/media.ts` → `compressImage()` before upload. Brian said high-quality
   photos matter to him and wasn't sure he wants this. **Decision pending:**
   relax (e.g. raise to a larger max + higher quality) or remove it entirely so
   photos upload at full resolution. *(Videos are handled server-side now and are
   unaffected.)*
2. **Nightly DB backup to the mini (offered, not done).** A `pg_dump` cron on the
   mini that pulls a nightly snapshot of the Supabase database to local disk — an
   off-cloud copy Brian owns, without the risk of self-hosting. Brian said "not
   now." Pick up if he wants it.
3. **Self-hosting Supabase: DECIDED — don't.** We discussed it; the database is
   the single source of truth (auth + all content + realtime) and the app is
   coupled to the full Supabase API, so it stays **managed**. If the free-tier
   inactivity pause becomes annoying, the answer is Pro (~$25/mo), not
   self-hosting. (Full reasoning is in the chat; don't re-litigate unless asked.)

## How the push triggers work (so you can tune it)
`media-server/push-sender.js` listens to Supabase realtime:
- new `committee_messages` → notifies other members of that committee whose
  `push_level` is `all`, or `mentions` if they were @mentioned or the message
  replies to one of theirs. Title = committee name, body = `Name: text` (or
  "sent a photo/video/sticker/GIF"), deep-links to `/posts?c=<slug>`.
- new `announcements` (broadcast alerts) → everyone with `push_level != off`.
Icon/badge = `/icon-192.png` (the MLR logo). De-dupes across realtime reconnects.

---

_Generated at the end of the June 4 2026 session. Branch: `claude/text-app-ui-experience-JNw6D` (merged to `main`)._
