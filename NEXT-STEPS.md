# Muskellunge Lake Resort — Next Steps

Follow-up checklist for finishing the **MLR** + **Family Fest** apps from your Mac mini.
This file lives in the `mlr-app` repo but covers **both** repos.

- **MLR (resort umbrella):** https://github.com/btheis15/mlr-app → live at https://btheis15.github.io/mlr-app/
- **Family Fest (event app):** https://github.com/btheis15/family-fest → live at https://btheis15.github.io/family-fest/

Both deploy to GitHub Pages automatically on every push to `main` (Settings → Pages → Source is set to "GitHub Actions"). The reference apps `stock-game` and `innjoy-mobile` are **not** part of this — leave them alone.

---

## 0. Where things stand

**Done & live (client-only v1, no backend yet):**
- MLR: Home, Activities, Dining & amenities, embedded Family Fest hub, Chat, Profile.
- Family Fest: Home (countdown), Schedule + dinner head-chefs (tap-to-call/text), Crew (RSVP + potluck), Photos (+ share to IG/FB), Pay (Venmo/Zelle).
- Model in both apps: **public to browse, name + email required only to interact** (post/RSVP/add photo).
- Admin role + admin-only alert composer + dismissible announcement banner (MLR).

**Not built yet (needs a backend — see §3):** real shared chat, email one-time-code login, Google-Drive-fed alerts/chef contacts, email + Android-push notifications, a shared (cross-device) photo album.

Everything backend-dependent is isolated to one module per feature, so each is a drop-in — see each repo's `CLAUDE.md` → "Backend seams".

---

## 0b. TARGET ARCHITECTURE — merge into one app ⭐

**Decision:** the end state is **one app**. MLR is *the* app; **Family Fest becomes a section inside MLR**, not a separate repo/deploy.

**Why it's a separate repo for now (on purpose):** Family Fest is the heaviest ongoing work, so it lives in its own repo as a workshop — you can iterate hard on it without destabilizing the MLR app. Fold it in once its feature set settles.

**Do the merge during the Supabase work (§3)** — that's the natural time, because once both share one login + one database, there's no reason to keep two apps.

**Migration checklist (mlr-app):**
- [ ] Move Family Fest routes under MLR: `app/family-fest/schedule`, `/family-fest/crew`, `/family-fest/photos`, `/family-fest/pay` (the `/family-fest` hub page already exists).
- [ ] Port the Family Fest components into `mlr-app/components`: `CrewView`, `PhotosView`, `DinnerCrew`, `PayView` (`Countdown` and `AnnouncementBanner` already exist here; MLR's `IdentityProvider` is the superset — use it, drop FF's).
- [ ] Merge Family Fest seed data into `mlr-app/lib` (e.g. a `lib/familyFest.ts`: `SCHEDULE`, `CREW`, `MEMORIES`, `DINNERS`, `PAYEES`) — or into Supabase tables.
- [ ] **Navigation:** decide how the section is reached — e.g. the existing Family Fest tab opens the hub, with its own sub-pages; or add a small in-section nav. Keep the bottom tab bar to ~5 items.
- [ ] **Theme:** MLR is dark, Family Fest is warm/light. Either scope the warm accent tokens to the `/family-fest/*` routes (a wrapper class) so the section feels festive inside the dark app, or fully adopt MLR's theme. Pick one.
- [ ] Replace the hub's external "Open the full Family Fest app" link (`FAMILY_FEST.appUrl`) with **internal navigation** to `/family-fest/schedule` etc.
- [ ] **Retire the `family-fest` repo:** archive it. Trade-off to decide first — keeping it deployed gives you a Family-Fest-only link/install for the event week; merging means one URL for everything. You can keep the repo as an archived standalone *and* have the section in MLR if you want both.

> Until you do this, the current setup (two apps, MLR embeds + links to Family Fest) keeps working fine — this is a consolidation, not a fix.

---

## 1. Local dev setup (Mac mini)

```bash
# Node 20+ recommended (Next.js 16). Check: node -v
git clone https://github.com/btheis15/mlr-app.git
git clone https://github.com/btheis15/family-fest.git

cd mlr-app
npm install        # .npmrc already sets legacy-peer-deps=true
npm run dev        # http://localhost:3000

# same for family-fest in another terminal (it'll use port 3001 if 3000 is busy)
```

Build check before pushing: `npm run build`.
To preview the GitHub Pages (static export) build locally: `PAGES_BASE_PATH=/mlr-app npm run build` then serve the `out/` folder.

---

## 2. Quick wins — replace the placeholder content

All seed content is plain data; no backend needed for these. Edit, commit, push → auto-deploys.

### family-fest → `lib/data.ts`
- [ ] `EVENT.startDate` / `EVENT.endDate` — real dates (currently 2026-07-11 → 2026-07-18).
- [ ] `EVENT.address` — real resort address.
- [ ] `EVENT.facebookGroupUrl` — your real Family Fest Facebook group link (used by photo "Share").
- [ ] `SCHEDULE` — the actual week's agenda.
- [ ] `CREW` — starting RSVP list (or clear it and let people add themselves).
- [ ] `DINNERS` — each night's dinner + **head chef name and phone** (E.164, e.g. `+17155550112`). Phones power the Call/Text buttons.
- [ ] `PAYEES` — real **Venmo usernames** (no `@`) and **Zelle handles** (email or phone) for the aunt (events) and your dad (food).
- [ ] `MEMORIES` — optional; swap the placeholder album tiles.

### family-fest → `lib/announcements.ts`
- [ ] `ANNOUNCEMENTS` — clear the demo "dinner moved" notice or replace with real ones (until the Drive feed is wired, §4).

### mlr-app → `lib/data.ts`
- [ ] `RESORT` — name, address, **phone** (E.164, used by "Call the front desk"), front-desk hours, check-in/out, WiFi network + password.
- [ ] `ACTIVITIES`, `DINING`, `AMENITIES` — real resort info.
- [ ] `ADMIN_EMAILS` — who can push alerts (currently `brian@innjoybnb.com`). Add your dad / aunt as needed.
- [ ] `FAMILY_FEST` — dates + `highlights`. `appUrl` already points to the live Family Fest site.
- [ ] `SEED_CHAT` — starter messages (or empty it once real chat is live).

### mlr-app → `lib/announcements.ts`
- [ ] `ANNOUNCEMENTS` — same as above.

> Tip: keep all phone numbers in **E.164** (`+1` + 10 digits) so `tel:`/`sms:` links work on both iPhone and Android.

---

## 3. The backend — Supabase (the big one)

You chose **Supabase**: one service that covers email one-time-code login, a database, realtime chat, and photo storage. Do this once and most of the "not built yet" list lights up.

### 3a. Create the project
- [ ] Create a Supabase project. Note the **Project URL** and **anon public key**.
- [ ] Add to each app as env vars (and in Vercel/Pages build env if needed):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `npm install @supabase/supabase-js` in each repo; add a `lib/supabase.ts` client.

> ⚠️ GitHub Pages serves **static files only** — there's no server to hold secrets. The `NEXT_PUBLIC_*` anon key is safe to ship (it's meant to be public, protected by Row Level Security). But anything needing a **secret** (Resend key, Drive service account, web-push private key, admin enforcement) needs a real server — use **Supabase Edge Functions** or move hosting to **Vercel**. See §7.

### 3b. Auth — email one-time code
- [ ] Enable Supabase Auth **email OTP / magic link**.
- [ ] In `components/IdentityProvider.tsx` (both apps): replace the on-device `persist()` step with: send OTP → verify code → set the real session. The `promptSignIn()` flow and "public browse, sign-in to act" UX stay exactly the same; you're just swapping what happens on submit.
- [ ] Store profile (name, email, `email_alerts`, `is_admin`) in a `profiles` table; move the admin check off the client `ADMIN_EMAILS` list to a DB column / RLS policy so it can't be spoofed.

### 3c. Database tables (suggested)
- [ ] `profiles` — id (auth uid), name, email, email_alerts (bool), is_admin (bool).
- [ ] `messages` — id, author_name, author_id, text, created_at. (MLR chat)
- [ ] `rsvps` — id, household, headcount, status, bringing, created_by. (Family Fest crew)
- [ ] `photos` — id, storage_path, caption, created_by, created_at.
- [ ] `announcements` — id, severity, title, body, created_at, created_by. (admin alerts + Drive feed both write here)
- [ ] Add **Row Level Security**: anyone can `select` (public read); only authenticated users can `insert`; only admins can write `announcements`.

### 3d. Wire the views to the DB (replace the localStorage/seed code)
- [ ] **Chat** — `components/ChatView.tsx`: read/insert `messages`, subscribe via Supabase **Realtime** for live updates. Remove the "stored on this device" note.
- [ ] **Crew/RSVP** — `family-fest/components/CrewView.tsx`: read/insert `rsvps`.
- [ ] **Photos** — `family-fest/components/PhotosView.tsx`: upload to a Supabase **Storage** bucket; list from `photos`. This makes the album shared across everyone (currently device-local).
- [ ] **Announcements** — `lib/announcements.ts` `getAnnouncements()`: read from the `announcements` table; `lib/localAnnouncements.ts` (admin composer) inserts a row instead of writing localStorage.

---

## 4. Google Drive → app (event changes & chef contacts)

Goal: update a Drive file, the app updates. The seam is already in place.

- [ ] Decide the source format: easiest is a **published-to-web CSV/JSON** from a Google Sheet (no auth); more control is the **Drive API with a service account** (needs a secret → server).
- [ ] Add a server route (Supabase Edge Function or Vercel route) that reads the file → maps rows to the shape and writes/returns `Announcement[]` and `Dinner[]`.
- [ ] Point `lib/announcements.ts` `getAnnouncements()` at it; point `family-fest` `DINNERS` at it. Revalidate on a short interval or via a Drive push notification/webhook.
- [ ] Data shapes to match: `Announcement` (`lib/types.ts`) and `Dinner`/`Chef` (`family-fest/lib/types.ts`).

---

## 5. Alerts — email + Android push (admin-only broadcast)

- [ ] **Who can send:** enforce admin server-side (Supabase RLS / Edge Function), not just the client list.
- [ ] **Email alerts:** when an admin posts an announcement, email everyone with `email_alerts = true`. Use **Resend** (or SendGrid) from a Supabase Edge Function (keep the API key server-side). The opt-in flag is already captured at sign-in and on the Profile screen.
- [ ] **iOS:** web push is unreliable on iOS PWAs, so email is the iOS path (already the plan).
- [ ] **Android push (optional):** add a service worker + Web Push API with **VAPID** keys; store push subscriptions in a table; send on alert. Add an "Enable push (Android)" toggle on Profile (placeholder text is already there).

---

## 6. Social photo sharing (Instagram / Facebook)

- Already works: the Photos "Share ↗" button uses the **Web Share API** → the phone's native share sheet (Instagram, Facebook, Messages, etc.), with the Facebook group as a fallback.
- [ ] Set `EVENT.facebookGroupUrl` (§2) so the fallback opens your real group.
- [ ] **Direct auto-post into a FB group** (no native sheet) requires **Meta app review** + the Graph API and is a heavier lift. Recommendation: keep the Web Share approach unless you specifically need silent auto-posting.

---

## 7. Deployment notes

- **Current:** GitHub Pages, auto-deploy on push to `main`. Static export under a subpath (`/mlr-app`, `/family-fest`) via `PAGES_BASE_PATH` in `.github/workflows/pages.yml`.
- [ ] **PWA on a subpath caveat:** because the site is served at `…github.io/mlr-app/`, the manifest/icon links (absolute `/…`) can 404 — cosmetic, but "Add to Home Screen" branding may be off. Fixed by a **custom domain** served at the root (then drop `basePath`), or by hosting on **Vercel**.
- [ ] **Vercel option:** the config auto-detects — with no `PAGES_BASE_PATH` it builds normally at the root (cache headers on). If you want a backend with secrets, Vercel + Supabase is the smoother combo than Pages. Import each repo at vercel.com and it just works.
- [ ] **Custom domain (optional):** point e.g. `app.muskellungelakeresort.com` at whichever host you pick.

---

## 8. Suggested order

1. Replace placeholder content (§2) — instant payoff, no backend.
2. Keep building out Family Fest in its own repo (that's why it's separate — it's the heaviest ongoing work; isolating it keeps MLR stable).
3. Stand up Supabase + email-OTP auth (§3a–3b).
4. Move chat, RSVP, photos to Supabase (§3c–3d) — the "real multi-user" jump.
5. Merge Family Fest into MLR as a section (§0b) — best done here, once both share one login + DB and the FF feature set has settled.
6. Admin alerts → email via Edge Function + Resend (§5).
7. Google Drive feed for announcements + chef contacts (§4).
8. Android web push (§5, optional).
9. Custom domain / hosting polish (§7).

---

## 9. Key files (map)

| Concern | MLR | Family Fest |
|---|---|---|
| Seed content | `lib/data.ts` | `lib/data.ts` |
| Types | `lib/types.ts` | `lib/types.ts` |
| Announcements (Drive seam) | `lib/announcements.ts`, `lib/localAnnouncements.ts` | `lib/announcements.ts` |
| Identity / sign-in | `components/IdentityProvider.tsx` | `components/IdentityProvider.tsx` |
| Chat | `components/ChatView.tsx` | — |
| RSVP | — | `components/CrewView.tsx` |
| Photos / sharing | — | `components/PhotosView.tsx` |
| Dinner chefs | — | `components/DinnerCrew.tsx` |
| Pay | — | `components/PayView.tsx` |
| Alert banner | `components/AnnouncementBanner.tsx` | `components/AnnouncementBanner.tsx` |
| Admin composer | `components/AdminAlertComposer.tsx` | — |
| Deploy workflow | `.github/workflows/pages.yml` | `.github/workflows/pages.yml` |

Each repo's `CLAUDE.md` has the per-repo detail and the "Backend seams" table.
