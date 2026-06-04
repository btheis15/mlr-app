# MLR media server (Mac mini)

Stores + serves the app's post photos/videos **and committee-chat attachments**
from your Mac mini, so we're not capped by cloud storage. **Login and all data
stay on cloud Supabase** — this only holds the media *files*, and the app saves
a link to each file here.

## Storage layout

New uploads are filed by feature + month so the folder never becomes one giant
flat pile (the upload route picks the folder from `?category=` / `?room=`):

```
<MEDIA_DIR>/
  posts/<YYYY-MM>/<uuid>.<ext>        # Posts feed
  posts/legacy/<uuid>.<ext>          # files from before this layout
  chat/<committee-slug>/<YYYY-MM>/…   # committee-chat attachments
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
tailscale funnel 8787       # exposes it publicly over HTTPS
```
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

## Notes
- ⚠️ The `PUBLIC_URL` must stay constant — the app stores the URLs this returns.
- Photos are compressed by the app before upload; videos upload as-is (cap via `MAX_MB`).
- Endpoints: `POST /upload?category=posts|chat[&room=<slug>]` (auth, field `file`), `GET /f/<path>` (public), `GET /assets/<path>` (public), `GET /health`.
