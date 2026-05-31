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

### 3b. Auth — PASSWORDLESS, FREE: email code + saved session ✅ (DECIDED)

**Decision (free + best UX): Supabase Auth email OTP with a long-lived, persisted session.** No passwords, no paid auth vendor.

> Keep it simple — this doesn't need to be high-security. The whole goal is just: **a real, verified email is required to interact** (browsing stays open). Email OTP confirms the address is theirs, the saved session keeps it effortless, and that's enough. No passwords, no passkeys, no heavy security work.

How it feels to a user:
1. Enter email → a 6-digit code lands in their inbox → type it → in. No password to create or remember.
2. Supabase saves the session (refresh token) on the device and auto-refreshes it, so they **stay logged in on that device** — they only re-enter a code on a new device or after signing out. (This is the "save a cookie to their device" you described.)

**Keep it free *and* reliable — custom SMTP:**
- [ ] Supabase's built-in code emails use a shared mailer that's **rate-limited** (a few/hour) — fine for testing, risky for real use. Plug a **free SMTP** into Supabase Auth → Email so codes always arrive at $0: **Resend** free tier (3,000/mo) or a **Gmail/Workspace SMTP**. OTP volume is tiny (one code per login), so a free tier easily covers it.

**Passkeys / Face ID = OPTIONAL, later (not now):**
- Supabase has no native passkey support, so Face ID would mean a custom WebAuthn build — extra work, and the email-code-plus-saved-session above already delivers "easy, no password." So **skip it for v1.** Revisit only if you later want one-tap biometric sign-in; it's a nice-to-have, not required. **Not using Stytch** (avoids any paid tier).

**Wiring:**
- [ ] `npm install @supabase/supabase-js`; create `lib/supabase.ts` with `persistSession: true` + `autoRefreshToken: true` (defaults) so the session sticks.
- [ ] In `components/IdentityProvider.tsx` (both apps): replace the on-device `persist()` with → `signInWithOtp({ email })` → verify code (`verifyOtp`) → real session. The `promptSignIn()` + "public browse, sign-in to act" UX stays identical — only what happens on submit changes.
- [ ] On load, restore the existing Supabase session (so returning users skip the code automatically). Sign out clears it.
- [ ] Store profile (display_name, avatar, `email_alerts`, `is_admin`) in `profiles`; move the admin check off the client `ADMIN_EMAILS` list to a DB column / RLS policy so it can't be spoofed.

### 3b-2. Rich, customizable profiles ⭐ (this is becoming a light social app)

Members register with email, then build a profile that's used **everywhere** in both apps. The key idea: throughout the UI people are shown by their **display name + avatar**, never their legal name or email.

- [ ] `profiles` fields (beyond the basics): `display_name` / nickname (Matthew → "Matt"), `avatar_url`, optional `full_name` (private), maybe `household`, `bio`/short blurb.
- [ ] **Avatar upload** → Supabase **Storage** bucket; show it in chat, photo posts, RSVP, member directory.
- [ ] **Display everywhere by `display_name` + avatar:** chat messages, photo captions/uploader, RSVP, "posted by". Store `author_id` on each row and render the *current* profile (so a name/avatar change updates retroactively) rather than copying the name onto each message.
- [ ] Emails live in `member_emails` (see §5b), not as a single column.
- [ ] Profile editor screen: avatar, display name, my emails (+ which is for group mail), notification prefs, directory opt-out.
- [ ] Keep it extensible — expect to add more per-profile fields over time (this is the "social" layer).

**Viewable member profiles (the "mini family social network"):**
- [ ] **Tappable profiles everywhere** — a name/avatar in chat, a committee roster (§5c), the member directory (§5b), an RSVP, a "posted by" → opens that member's **profile page**.
- [ ] **Public profile page** shows: avatar + display name, **which committees they're in** (linked to each committee), and whatever fields they've chosen to make public (e.g. email, household, bio, phone). Eric's page shows Eric's committees + his public info; tapping a committee jumps to it.
- [ ] **Your own profile** shows the same, plus your committees as **quick links**, and edit controls.
- [ ] **Per-field privacy** — each profile field (and each email) has a **public / members-only / private** visibility toggle. Default sensible (e.g. display name + avatar + committees visible to members; email private unless they opt to share). Only what the member marks shareable shows on their public page.
- [ ] Data: add a `visibility` setting per field (e.g. a `profile_visibility` JSON/columns, and `member_emails.public` bool). A `/members/[id]` profile route reads `profiles` + `committee_members` (their committees) + the public subset of `member_emails`.

### 3c. Database tables (suggested)
- [ ] `profiles` — id (auth uid), display_name, avatar_url, full_name (optional/private), bio, household, email_alerts (bool), is_admin (bool), include_in_directory (bool), plus per-field **visibility** settings (public / members-only / private). A `/members/[id]` route renders the public subset.
- [ ] `member_emails` — id, user_id, email, label, verified (bool), use_for_group (bool), **public** (bool — show on profile). (See §5b.)
- [ ] `messages` — id, author_id (→ profiles), text, created_at. Render the current `display_name`/avatar by join, don't copy the name onto the row. (MLR chat)
- [ ] `rsvps` — id, household, headcount, status, bringing, created_by (→ profiles). (Family Fest crew)
- [ ] `photos` — id, storage_path, caption, created_by (→ profiles), created_at.
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

## 5b. Member directory & "email everyone" (always-current addresses) ⭐

**The problem it kills:** today mass emails go to hand-maintained lists, so people get missed, old addresses linger, and the same person shows up as 3–4 stale addresses in a thread. Since everyone logs in with their email, the app already *is* the source of truth — let members keep their own address current and let anyone compose to people by **name**, not by typing addresses.

**Data model (Supabase):**
- [ ] `member_emails` table: `id`, `user_id` (→ profiles), `email`, `label` (e.g. "personal" / "work"), `verified` (bool), `use_for_group` (bool). A person can add several; they flag which one(s) receive group email. Verify each new address with a one-time code (same OTP flow as login) before it's usable.
- [ ] Profile screen: "My emails" — add/remove addresses, mark the one to use for group messages. (This same delegated address is what alert emails in §5 should use.)
- [ ] `include_in_directory` / opt-out flag per member ("don't include me in member emails").

**Compose flow (new screen, e.g. `/members` or a "Message" action):**
- [ ] Multi-select recipients **by name**, plus "Select all".
- [ ] App resolves each selected member → their delegated (`use_for_group`) verified email. No address list is ever typed or stored by the sender.

**Sending — two options:**
- [ ] **v1 (no email server):** build a `mailto:?bcc=<resolved,addresses>&subject=…&body=…` that opens the sender's own mail app pre-filled. Genuinely "from them," replies thread normally, zero setup. Caveat: URL length limits very large lists; chunk if needed.
- [ ] **v2 (app-sent):** Supabase Edge Function + **Resend** sends the blast with **Reply-To = sender's chosen email** so replies go to them. Better for big lists/threads/tracking; needs domain SPF/DKIM/deliverability setup.

**Privacy & control:**
- [ ] Always **BCC** (or server-send) so members can't harvest each other's addresses.
- [ ] Decide who may email everyone: any signed-in member, or admins only. Add light rate-limiting / abuse guard if it's open to all.

---

## 5c. Committees (volunteer member groups + request-to-join) ⭐

Named groups of volunteer members who've agreed to help with an area. Members can see each committee, who's on it, and what's happening; anyone can **request to join**, and an **admin (or committee lead) approves** to add them.

**The committees:**
- **Beautification** (MLR) — planting trees, maintaining paths, ideas to make the resort look nicer.
- **Maintenance** (MLR) — cabin updates, mowing, general upkeep.
- **Family Fest committee** (Family Fest section) — meal planning, event planning for the fest week.

**Each committee shows:**
- [ ] Description + emoji/icon.
- [ ] **Member roster** — display_name + avatar (from `profiles`), with an optional "lead" badge.
- [ ] **What's happening** — an activity feed: posts/updates (and optionally simple tasks/to-dos) scoped to that committee. (Reuse the chat/posts pattern, filtered by committee.)
- [ ] **Request to join** button → creates a pending request (signed-in members only; guests get the sign-in prompt).

**Admin / lead review:**
- [ ] A "Join requests" view (in the admin area, or per-committee for its lead): approve → insert into `committee_members`; decline → mark declined. Optionally notify the requester by email (ties to §5/§5b).

**Data model (Supabase):**
- [ ] `committees` — id, slug, name, description, emoji, scope (`mlr` | `family-fest`).
- [ ] `committee_members` — id, committee_id, user_id (→ profiles), role (`member` | `lead`), joined_at.
- [ ] `committee_join_requests` — id, committee_id, user_id, message (optional), status (`pending`|`approved`|`declined`), created_at, reviewed_by.
- [ ] RLS: anyone signed-in can read committees/members and insert a join request; only admins/leads can approve or post as the committee.

**Where it lives:**
- [ ] **MLR:** a `/committees` list + `/committees/[slug]` detail (Beautification, Maintenance). Reach it from a Home nav card (bottom tab bar is already at 5).
- [ ] **Family Fest:** the Family Fest committee as a section reached from the FF Home (or, after the §0b merge, it's just another committee under MLR scoped to `family-fest`).

> Buildable as a **static preview now** (seed the 3 committees + rosters + a sample activity feed; "Request to join" prompts sign-in) — but the real request→approve loop and live rosters need the backend, so it slots into the Supabase phase.

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
3. Stand up the backend + **passwordless auth** — Supabase email OTP + saved session (§3a–3b). No passwords, no paid vendor.
4. Move chat, RSVP, photos to Supabase (§3c–3d) — the "real multi-user" jump.
5. Merge Family Fest into MLR as a section (§0b) — best done here, once both share one login + DB and the FF feature set has settled.
6. Admin alerts → email via Edge Function + Resend (§5).
7. Member directory + "email everyone" by name (§5b) — builds on profiles + verified emails.
8. Committees + request-to-join/admin-approve (§5c) — builds on profiles + admin roles.
9. Google Drive feed for announcements + chef contacts (§4).
10. Android web push (§5, optional).
11. Custom domain / hosting polish (§7).

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
