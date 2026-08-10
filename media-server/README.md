# MLR media server (Mac mini)

Stores + serves the app's post photos/videos **and committee-chat attachments**
from your Mac mini, so we're not capped by cloud storage. **Login and all data
stay on cloud Supabase** — this only holds the media *files*, and the app saves
a link to each file here.

> ### ⚠️ This mini's ports & public endpoint (read before touching networking)
> Port **8787 is permanently owned by an unrelated Innjoy dashboard** (its
> hardcoded default, referenced across `pricelabs_api`'s docs/launchers — not safe
> to move), and **8799 by `fm`**. So this media server runs on **`PORT=8790`**.
> Port collisions have caused a real outage here before — check `lsof -i :<port>`
> before claiming one.
>
> **Media is served directly, NOT through Tailscale Funnel (changed 2026-08-10).**
>
> | Public URL | → | serves |
> |---|---|---|
> | `https://mlr-media.duckdns.org` (443) | eero forwards 443 → **9443** (Caddy) → `127.0.0.1:8790` | **this media server** |
> | `https://brians-mac-mini.tail49943c.ts.net` | Funnel → `127.0.0.1:8790` | legacy fallback, still live |
> | `https://brians-mac-mini.tail49943c.ts.net:8443` | Funnel → `127.0.0.1:8787` | Innjoy dashboard |
>
> **Why the move:** Funnel relays through Tailscale's DERP infrastructure and
> measured **12–21 Mbps (varying 1.7×) against a 119 Mbps uplink** — ~15% of real
> capacity. A 36 Mbps video could not be watched in real time. Direct serving is
> limited only by the uplink; Caddy itself does ~445 Mbps locally.
>
> **Caddy runs unprivileged on 9443** (not 443, which would need root; not 8443,
> which the Funnel already publishes). The *external* port is still 443, so stored
> URLs carry no `:port`. Config: `/opt/homebrew/etc/Caddyfile`, `brew services`.
> Let's Encrypt validates over **TLS-ALPN on 443** — Comcast blocks inbound 80.
>
> ⚠️ **`PUBLIC_URL` is stored VERBATIM in ~1,700 database rows.** Changing it means
> another data migration across seven columns (see
> `supabase/one-off/2026-08-10_media_url_host_swap.sql` for the pattern, and keep
> the old endpoint alive during the swap so a missed row still resolves).
>
> **Dynamic DNS:** Comcast rotates this house's IP, so
> `scripts/duckdns-update.sh` runs every 5 min via `com.mlr.duckdns` launchd.
> A stale record 404s all media for everyone — this job is load-bearing.
> Credentials in the gitignored `.env` (`DUCKDNS_DOMAIN` / `DUCKDNS_TOKEN`).
>
> **Trade-off accepted:** the home IP is now published in DNS and the mini is
> directly reachable on 443. It has `helmet`, per-endpoint rate limits, and auth
> on uploads, but no WAF and no DDoS absorption. Cloudflare Tunnel remains the
> alternative (hides the IP, adds edge caching) at the cost of another URL
> migration.

## Storage layout

New uploads are filed by feature + month so the folder never becomes one giant
flat pile (the upload route picks the folder from `?category=` / `?room=`):

```
<MEDIA_DIR>/
  posts/<YYYY-MM>/<uuid>.<ext>        # Posts feed
  posts/legacy/<uuid>.<ext>          # files from before this layout
  chat/<committee-slug>/<YYYY-MM>/…   # committee-chat attachments
  work/<YYYY-MM>/…                    # work-item attachments
  dropbox/<box-id>/<YYYY-MM>/…        # shared drop-box folders (0171)
```

`GET /f/<…>` serves the whole tree, **plus** a fallback mount on `posts/legacy`,
so flat `/f/<uuid>.<ext>` URLs already saved in the database keep resolving after
you tidy old files away. To do that tidy on the mini (safe, no DB changes):

```bash
MEDIA_DIR=/Users/brian/mlr-app/media-server/media bash scripts/organize-legacy.sh
```

## Two volumes: SSD primary + external backup

Media lives on **two** drives, with one shared URL space:

| | env var | role |
|---|---|---|
| **Hot** | `MEDIA_DIR` | The mini's internal SSD. **Primary** — every upload lands here and every read is served from here first. |
| **Cold** | `MEDIA_COLD_DIR` | The external drive. A **full backup mirror** of hot, and the only home for files over the per-file SSD limit. |

The app stores media as `<PUBLIC_URL>/f/<rel>` and **never records which disk the
bytes are on**. That's the whole trick: `/f` is a chain of four `express.static`
roots (hot, hot-legacy, cold, cold-legacy), so a file found on either volume
serves at the same URL. Nothing in the database changes when a file moves.

**Why the SSD at all**, given the external drive holds everything? Latency on
recent media. Photo grids are many small random reads — dozens of seeks, exactly
where a spinning disk is slowest — and recently-uploaded photos are the ones
people are most likely to open, because they haven't seen them yet. Video is the
opposite: streamed once, sequentially, at speeds far above what the tunnel can
deliver anyway.

### Where a new upload goes

Decided once, before any bytes are written, by `pickUploadRoot()` in
[`media-tiers.js`](media-tiers.js). In priority order, a file goes to the
**external drive** if it:

1. is **larger than `MEDIA_HOT_MAX_FILE_MB`** (default **250 MB**) — a hard
   per-file ceiling on the SSD regardless of free space, or
2. would leave less than `MEDIA_HOT_RESERVE_GB` (default **15 GB**) free on the
   boot disk, or
3. would push the library past `MEDIA_HOT_ALLOWANCE_GB` (default **25 GB**).

Otherwise it goes to the SSD. There is deliberately **no rule about file type** —
the size limit already routes video where it belongs.

With no external drive configured, rules 1 and 3 degrade to "SSD anyway" (they're
policy), but rule 2 is a hard floor: an upload that would fill the boot disk is
refused with **507**, because a full boot disk takes down the whole machine, not
just this server.

**Deciding up front is the point.** The alternative — write somewhere, then
move — makes every misroute a full re-copy of the largest files in the system.
`/upload` is `upload.single("file")`, so `Content-Length` is effectively the one
file's size; a batch of photos is N separate requests, each routed on its own
size.

### The backup sweep

[`mirror-sweep.js`](mirror-sweep.js) runs every 10 minutes and copies anything
the external drive is missing (or has at a different size). It's **reconciling,
not a queue** — no pending-work table, no retry list. If the drive was unplugged
for a week, the next pass just finds more to do. Copies are atomic per file
(temp name on the destination, size-verified, then renamed), so a drive yanked
mid-copy leaves a discarded `.part` file rather than a truncated "backup".

Two things it deliberately does **not** do:

- **It never prunes cold on its own.** A backup that decides for itself what to
  drop isn't a backup. Removing deleted media is a *separate* job with its own
  safeguards — see **Deleted media** below — not something the mirror infers from
  a file's absence.
- **It never evicts from hot.** Nothing leaves the SSD until the library actually
  approaches its allowance, and that policy is a separate change. There is
  intentionally no unlink-from-hot code in the tree yet.

## Deleted media: quarantine, then purge after 7 days

Deleting a photo in the app removes its `*_media` **row**; it never touched the
**file**. So every photo ever deleted was still on disk — a hard-deleted drop box
left **438 photos** behind, ~558 MB.

[`orphan-sweep.js`](orphan-sweep.js) reconciles the two sides every 6h: any file
no database row references is moved to quarantine, and
[`media-trash.js`](media-trash.js) purges it permanently after
`MEDIA_TRASH_RETENTION_DAYS` (**7**). Reconciling rather than hooking each delete
path means a deletion from **any** surface — member remove, admin remove, an RPC,
a cascade from deleting a whole box, iOS — is picked up, and a missed event just
means the next pass catches it.

```
<COLD_DIR>/_trash/<batch-timestamp>/<original media-relative path>
```

Quarantine sits **inside** the media folder (not at the drive root) so everything
this app touches lives under one directory. `_trash` is therefore excluded from
four things, and every one matters: **`/f` serving** (else deleted media stays
downloadable for a week), the **usage walk** (else the storage meter grows on
every delete), the **mirror sweep** (else trash gets mirrored as live media), and
the **orphan sweep** (else it quarantines the quarantine, forever).

### ⚠️ This is the most dangerous job in the server

It decides that irreplaceable family photos are unreferenced and removes them. A
bug, a half-finished query, or one forgotten table means real photos disappear.
Every safeguard below is load-bearing:

| safeguard | what it prevents |
|---|---|
| **Quarantine, not delete** (7-day hold) | an accidental album deletion being instantly unrecoverable |
| **Fail closed** — any table read error aborts the whole sweep | a partial reference set looking identical to "these are orphans" |
| **Sanity floor** — abort if <25% of files look referenced | a silently-empty query condemning the whole library |
| **Basename matching** as well as path | the flat legacy `/f/<uuid>.<ext>` URLs (files live at `posts/legacy/…`) being quarantined — this would hit the app's *oldest* photos |
| **Thumbnail parent check** | a `_thumb.jpg` being dropped when its object is still referenced |
| **48h grace period** | an in-flight upload being deleted (the client inserts its row *after* `/upload` returns) |
| **`assertInsideMediaRoot()` on every mutation** | ever touching anything outside the app's own media folders — the external drive holds ~180 GB of unrelated personal files |
| **Bytes reach trash before any unlink** | a crash mid-move destroying the only copy |

**If you add a table that stores a `/f/` URL, add it to `REF_TABLES`.** A missing
table orphans that entire feature's media. The list is verified against every
`uploadToMini()` caller in the app and mirrors `MEDIA_URL_TABLES` in `server.js`.

### Restoring something

```bash
node -e 'require("./media-trash").restore("<batch>", "<rel/path.jpg>").then(console.log)'
```

It goes back to whichever volume the routing rules pick, and the mirror re-creates
the backup copy on its next pass. A hand-named folder inside `_trash` is **never**
auto-purged, so renaming a batch pins it indefinitely.

### Dry run first

`sweepOnce({ admin, dryRun: true })` reports exactly what it would quarantine and
touches nothing. Worth running after any change to the reference logic.

When eviction does ship it's a plain `unlink`, not a cross-volume move, because
the mirror already put a copy on cold — dropping the SSD copy just makes the next
request fall one root further down the `/f` chain.

### If the external drive is unplugged

The server **keeps running** (this used to be a fatal startup error, which took
photos, chat, push and email down over a missing video drive). It serves
everything the SSD has, writes no backups, and 404s anything stored only on the
external drive. `coldReady()` re-checks at runtime, so **replugging needs no
restart**. The owner's Media server card shows the drive as disconnected.

`MEDIA_DIR` itself is still fatal if it's a `/Volumes` path that isn't mounted —
that's where we *write*, and silently recreating it as an empty folder on the
boot disk is how you 404 the entire library.

## Video transcoding

Uploaded **videos** are normalized to a web-friendly **H.264 MP4 capped at ~1080p**
(`transcode.js`), so iPhone HEVC/`.mov` clips play on every device and 4K clips
don't balloon the disk or everyone's cell data. **Photos are left untouched**
(full quality). A clip that's already H.264 MP4 within the cap is passed through
as-is — we never needlessly re-encode an already-good video, and we never upscale.

Requires **ffmpeg** on the mini:

```bash
brew install ffmpeg
```

If ffmpeg isn't installed, uploads still work — videos are just stored as-is
(the server logs a warning at startup). Tuning knobs (`VIDEO_CRF`,
`VIDEO_MAX_LONG_EDGE`, `VIDEO_PRESET`, `VIDEO_TRANSCODE=off`, …) are in
`.env.example`. After pulling this update on the mini, just restart the server.

Uploads are gated to signed-in family members (the Supabase token is verified
against the cloud project). Read access is public (so anyone with the app link
can view the photos).

## Security hardening

- **CORS fails closed.** `ALLOWED_ORIGINS` unset/empty no longer means "allow
  any origin" — the server logs a startup warning and falls back to just the
  known production origin (`https://mlr-app-omega.vercel.app`). Set
  `ALLOWED_ORIGINS` explicitly in `.env` if you need another origin (e.g.
  `http://localhost:3000` for local dev).
- **Rate limiting** (`express-rate-limit`, per-IP): a modest global floor
  (600 req / 15 min) plus tighter limits on the routes worth abusing —
  `/upload` (30/hour), `/moderate/text` (60/min), `/geocode` (30/min). Sized to
  be generous for a family posting a burst of fest photos, not for scraping or
  abuse. Requires `app.set("trust proxy", 1)` (already set) so the tunnel in
  front doesn't collapse every family member into one "IP" — if you ever put a
  *second* proxy hop in front of the tunnel, revisit that setting.
- **`/geocode` now requires sign-in** (same `requireUser` check as `/upload`) —
  it used to be open to anyone, letting the mini be used as an anonymous free
  proxy to the Census/Nominatim geocoders.
- **`helmet`** adds baseline security headers. CSP is intentionally **off**
  (this server never serves HTML pages with scripts, just JSON + static
  media/assets, and a default CSP fights static file responses); the
  cross-origin resource/embedder policy is relaxed so the Next app — a
  different origin — can still `<img>`/`<video>` embed the media this server
  serves.
- **`MAX_MB` is now 50 GB** (`50 * 1024`), i.e. "effectively unlimited, it's a
  video." Files that big route to the external drive automatically (see **Two
  volumes** above), so the cap no longer has to double as a disk guard.
  ⚠️ This number does **not** mean a 50 GB upload will succeed — two other things
  bind first, both outside this server:
  - **Bandwidth.** 50 GB over a residential uplink is hours; on the LAN it's
    minutes. `UPLOAD_TIMEOUT_MS` (default 4h) has to cover the whole transfer,
    which is why it moved up with the cap — raising `MAX_MB` alone would just
    convert a clean 413 into a timeout partway through, wasting the transfer.
  - **The tunnel** in front (Tailscale Funnel / Cloudflare Tunnel) may cap
    request body size on its own and reject the upload before it reaches this
    process. Worth testing with one real large file before telling the family
    it works.

**Deploying this update to the mini:** `git pull`, then `npm install` (adds
`express-rate-limit` + `helmet` to `node_modules` and updates
`package-lock.json`), then restart (`pm2 restart mlr-media`, or re-run
`npm start`). Nothing here needs a new env var to work — `ALLOWED_ORIGINS` and
`MAX_MB` in an existing `.env` still take precedence over the new defaults.

## Setup on the mini

**1. Get the code + Node 18+.**
```bash
git clone https://github.com/btheis15/mlr-app.git   # or: git pull
cd mlr-app/media-server
npm install
```

**2. Configure.** Copy `.env.example` → `.env` and fill it in (the Supabase
values are already filled; you'll set `PUBLIC_URL` after step 5):
```bash
cp .env.example .env
```

**3. Pick where files live.** Two settings (see **Two volumes** above):

```ini
MEDIA_DIR=/Users/brian/mlr-media                        # primary, internal SSD
MEDIA_COLD_DIR=/Volumes/External Hard Drive/mlr-media   # backup mirror
```

`MEDIA_DIR` defaults to `./media`. `MEDIA_COLD_DIR` is optional — leave it unset
and everything works, but **media then has only one copy** and the server says so
at boot and on the admin card. Optional tuning:
`MEDIA_HOT_MAX_FILE_MB` (250), `MEDIA_HOT_ALLOWANCE_GB` (25),
`MEDIA_HOT_RESERVE_GB` (15).

⚠️ **The external drive is a mirror, not an off-site backup.** Both copies are in
the same room on the same power strip, and files over the per-file limit live
*only* on the external drive, so they have no second copy at all. A third target
(another external, or ~$0.30/month for 50 GB at Backblaze B2) is the only thing
that survives a drive failure, theft, or a spilled drink.

**4. Run it.**
```bash
npm start            # foreground test
```
For always-on (recommended), use pm2:
```bash
npm i -g pm2
pm2 start server.js --name mlr-media
pm2 save && pm2 startup     # restart on reboot
```

**5. Put a STABLE public HTTPS tunnel in front.** Easiest free option that needs
no domain — **Tailscale Funnel**:
```bash
# install Tailscale, then:
tailscale up
tailscale funnel "$PORT"    # public 443 → this server; use YOUR PORT, not 8787
```
⚠️ On this mini `$PORT` is **8790**, NOT 8787 — see the ports warning at the top
of this file before running Funnel (8787 serves a different app). Verify after:
`tailscale funnel status` should show `443 → 127.0.0.1:8790`.
That prints a stable URL like `https://your-mini.your-tailnet.ts.net`.
Put that in `.env` as `PUBLIC_URL`, then restart (`pm2 restart mlr-media`).
*(Alternative: a **named** Cloudflare Tunnel if you own a domain — avoid the
random `trycloudflare.com` quick tunnels, those URLs change and would break
stored links.)*

**6. Verify** from any network:
```
https://your-mini.your-tailnet.ts.net/health   →  {"ok":true}
```

**7. Send me that `PUBLIC_URL`** — I'll point the app at it.

## Alert emails (optional)

The mini can also **email opted-in members** when an app admin or Family Fest
lead posts a broadcast alert (`alert-mailer.js`, started by `server.js`). It's
**off until you set** these in `.env`, then `npm install` + restart:

```
SUPABASE_SERVICE_ROLE_KEY=…   # ⚠️ powerful (bypasses RLS to read emails) — mini only, never the app
# Reuse the SAME SMTP you set up in Supabase Auth → SMTP (any provider):
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587                 # 465 ⇒ TLS; 587 ⇒ STARTTLS (or SMTP_SECURE=true)
SMTP_USER=…
SMTP_PASS=…
ALERT_FROM=Muskellunge Lake Resort <alerts@yourdomain.com>   # match your sender
# …or the Gmail shortcut: GMAIL_USER + GMAIL_APP_PASSWORD instead of SMTP_*.
```

It listens for new `announcements` (Supabase Realtime), pulls opted-in members'
emails via the `alert_recipients()` RPC, and BCCs them over SMTP — stamping
`email_sent_at` so an alert is never emailed twice. Blank vars = in-app banner
only (no email). New deps: `@supabase/supabase-js`, `nodemailer`. Note: Supabase
doesn't expose its own Auth SMTP for sending app email, so the mailer connects
with the same credentials directly.

## Push notifications (optional)

The mini can also send **web-push notifications** (`push-sender.js`, started by
`server.js`), filtered by each member's unified push list (Profile →
Notifications, `profiles.push_types`, migration 0034). Categories: broadcast
alerts, birthdays, committee decisions, cabin-stay decisions, post tags, comment
mentions, post replies, and new committee messages. The five feed-backed
categories are delivered by mirroring the matching in-app `notifications` row
(migration 0030/0033) to a push; chat / alerts / birthdays ride their own
senders. New members opt in via a one-time first-run prompt. Works on Android,
and on iPhones that have **added the app to the Home Screen** (iOS 16.4+).

**Off until you set the VAPID keys.** Generate them once (after `npm install`):

```bash
npx web-push generate-vapid-keys
```

Then in `.env` (and restart):

```
SUPABASE_SERVICE_ROLE_KEY=…    # ⚠️ same powerful key as the mailer — mini only
VAPID_PUBLIC_KEY=…             # ALSO set in the app as NEXT_PUBLIC_VAPID_PUBLIC_KEY (must match)
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:alerts@yourdomain.com
APP_URL=https://mlr-app-omega.vercel.app   # deep links + notification icon
```

It listens for new `committee_messages`, `announcements`, `notifications`,
`profiles`, and `cabin_bookings` (Supabase Realtime), reads `profiles.push_types`
+ `push_subscriptions`, and delivers via `web-push`, pruning dead subscriptions.
Requires migrations through `0034`. Dep: `web-push`.

## Notes
- ⚠️ The `PUBLIC_URL` must stay constant — the app stores the URLs this returns.
- The server doesn't touch photos (the app may downscale very large ones before upload); **videos are transcoded** to ≤1080p H.264 MP4 (needs `ffmpeg`; see *Video transcoding*).
- Endpoints: `POST /upload?category=posts|chat|work|dropbox[&room=<slug|box-id>]` (auth, field `file`), `POST /moderate/text` (auth), `GET /geocode?q=&country=` (auth), `GET /f/<path>` (public; append `?dl=1` to force a download instead of inline), `GET /dropbox-zip?box=&token=` / `POST /dropbox-zip` (auth via token — zips a whole drop-box folder or a selection of `path`s via the system `zip`), `GET /assets/<path>` (public), `GET /health` (public).
- Admin endpoints (caller must be an app admin, else 401/403): `POST /admin/invite` `{ name, email }` — create a named account + email a sign-in code (needs `SUPABASE_SERVICE_ROLE_KEY`); `POST /admin/set-email` `{ userId, newEmail }` — set a member's email, allowed only while the two-admin override window is open (re-checked via `is_override_unlocked()`, migration 0025).
- Owner-only endpoints (caller's verified email must match `OWNER_EMAIL` in server.js, else 401/403 — narrower than the admin gate above, since restarting this process isn't an ordinary app-admin action): `GET /admin/media-server-status` — current commit + how many commits behind `origin/main`; `POST /admin/restart-media-server` — fast-forwards the mini's checkout to `origin/main` (409 if it can't, e.g. local commits), `npm install`s only if `media-server/package.json`/`package-lock.json` changed, then exits so launchd's `KeepAlive` relaunches it on the new code within `ThrottleInterval` (10s) — the app's Admin → Media server card (`/admin/system`, itself hidden from every admin except `lib/owner.ts`'s `OWNER_EMAIL`) is the one-tap trigger for the "`git pull` + restart" cycle this doc otherwise describes as a manual mini step.

## Video: a streamable rendition beside the untouched original

⚠️ **The transcoder used to DESTROY the original.** It re-encoded in place, so the
full-quality file the family actually shot was gone seconds after arriving —
irreversibly, for every video ever posted, including any 4K downscaled to 1080p on
the way through. And it judged a file "web-ready" on codec + container +
resolution while **never looking at bitrate**, so phone recordings sailed through
untouched at 18–36 Mbps. Worst of both worlds: quality lost *and* unwatchable.

Now every video keeps **two** files:

```
<uuid>.mp4        the playback rendition — bitrate-capped, faststart, streams
<uuid>_orig.<ext> the untouched upload — what ?dl=1 and album zips hand back
<uuid>_thumb.jpg  the grid preview
```

`storage_path` still points at `<uuid>.mp4`, so **no database change was needed**.

### Why bitrate, not storage, is the constraint

Playing 36 Mbps needs 4.6 MB/s sustained *to the viewer*. Measured on this mini:

| | |
|---|---|
| off the server directly | ~6.9 Gbps (page cache) |
| raw uplink | 119 Mbps |
| **through the public Tailscale Funnel** | **12–21 Mbps, varying 1.7×** |

So the HDD supplies ~27× more than a video needs and is never the bottleneck —
the tunnel is. That variance is also why loads feel inconsistent for no local
reason. `VIDEO_TARGET_MAX_MBPS` (default **10**) is the ceiling enforced with
`-maxrate`/`-bufsize`; CRF alone is quality-targeted and will happily emit 36 Mbps
on noisy handheld footage.

Frame rate is deliberately **preserved** (60fps stays 60fps) — the original is
kept, so the rendition only has to be watchable, and halving frame rate is the
most visible way to make motion worse.

### Backfill

`node scripts/recap-video-bitrate.js [--dry-run]` builds renditions for videos
that predate this change. Idempotent (skips anything with an `_orig` sibling).
Measured on the live library: **581 MB → 214 MB of playback bytes**, and the
newest clip went 36.5 → 10.3 Mbps, so a 39s video now downloads in 23s through the
tunnel instead of ~115s.

⚠️ For those files the true camera originals were **already destroyed** by the old
code. The backfill preserves the best available source (what was on disk), which
is not the same as the camera original.

### ⚠️ `_orig` and `_thumb` have no database row

Both are derived files owned by their parent object, referenced by nothing. Three
places must know that, or they'd delete or miscount exactly the files this feature
exists to keep:

- `orphan-sweep.js` `DERIVED_SUFFIXES` — spares them while the parent is referenced
- `media-usage.js` — folds their bytes into the parent so the meter doesn't double
- `/dropbox-zip` — excludes `_thumb`, and prefers `_orig` over the rendition

**Adding another derived-file suffix means updating all three.**
