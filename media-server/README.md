# MLR media server (Mac mini)

Stores + serves the app's post photos/videos **and committee-chat attachments**
from your Mac mini, so we're not capped by cloud storage. **Login and all data
stay on cloud Supabase** — this only holds the media *files*, and the app saves
a link to each file here.

> ### ⚠️ This mini's ports & Funnel (read before touching networking)
> Port **8787 on this mini is permanently owned by an unrelated Innjoy dashboard**
> process (it's that Python tool's hardcoded default, referenced across
> `pricelabs_api`'s docs/launchers — not safe to move). So this media server
> runs on **`PORT=8790`**, and the public Tailscale Funnel is mapped as:
>
> | Public URL | → local | serves |
> |---|---|---|
> | `https://brians-mac-mini.tail49943c.ts.net` (443) | `127.0.0.1:8790` | **this media server** |
> | `https://brians-mac-mini.tail49943c.ts.net:8443` | `127.0.0.1:8787` | Innjoy dashboard |
>
> **Do NOT set `PORT=8787` on this host**, and don't point 443's Funnel at 8787
> — that serves the dashboard, so every `…/f/<file>` 404s and the iOS/web apps
> show endless spinners (this exact outage happened once already). If a setup
> step or `.env.example` suggests `8787`, check for the collision first:
> `lsof -i :8787`. The `PUBLIC_URL` (the `…ts.net` name at 443) must stay
> constant — the app stores it verbatim in the database.

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
- **`MAX_MB` default lowered to 256** (was 1024). Bump it in `.env` if the
  family is uploading larger raw videos.

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

**3. Pick where files live.** Default is `./media`. To use an external drive,
set `MEDIA_DIR=/Volumes/.../mlr` in `.env`. **Back this folder up** (Time
Machine / rsync) — it's the only copy of the photos.

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
