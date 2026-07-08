# CLAUDE.md — mlr-app

Entry point for Claude/AI sessions on this repo. Read this first.

## What this repo is

A **Next.js 16 + React 19 + Tailwind v4 PWA** for **Muskellunge Lake Resort
(MLR)** — the year-round resort app. Mobile-first, vertical, **light mode only**,
built around the official **forest-green** MLR logo (white cabin-in-the-pines,
EST 1987) with vintage heritage from the original resort (Leo & Dorothy Theis ·
Fishing · Hunting · Boating · light-housekeeping cabins · Tomahawk, WI). Same
conventions as the author's other apps (`stock-game`, `innjoy-mobile`): App
Router, CSS-variable theme tokens, bottom `TabBar`, iOS install hint. Live on
**Vercel** (mlr-app-omega.vercel.app) + GitHub Pages; currently **read-only**
(see `lib/features.ts` `READ_ONLY`).

MLR is the **umbrella app**, and **Family Fest** (the one-week annual gathering)
is now a **built-in section** of it at `/family-fest/*` — schedule, dinners,
crew/RSVP, photos, pay, plus anytime "things to do" (the scavenger hunt). There's
no separate app and no "open the full app" hop anymore. The section keeps its own
**Renaissance / parchment look**, scoped via the `.ff-section` class +
[`app/family-fest/layout.tsx`](app/family-fest/layout.tsx) (Cinzel font), and has
its own in-section sub-nav ([`FamilyFestNav`](components/FamilyFestNav.tsx)); the
forest-green resort chrome (bottom tabs, announcements) stays above it. *(The
standalone `family-fest` repo is being retired/redirected to this section.)*

**One-app feel via a shared "season"** — rather than the full code merge (still
deferred to the Supabase phase, NEXT-STEPS §0b), both apps share a **Family Fest
season model** ([`lib/festSeason.ts`](lib/festSeason.ts), mirrored byte-for-byte
in the `family-fest` repo) so the fest reads as a *season of the resort* that
rises and recedes through the year across four phases: **off-season** (quiet
banner) → **planning** (from ~60 days out: a partial takeover that rallies
volunteers and previews what's being planned) → **live** (the event week: MLR
leads with Family Fest — a "Day n of N + today's events" takeover, a live dot on
the tab, resort content recedes) → **wrap** (2 weeks after: the full takeover
lingers, nudging people to post the photos they didn't get to). See **Family
Fest season** below.

**Data model:** client-only for now. Resort content (activities, dining,
amenities, Family Fest highlights) is static in [`lib/data.ts`](lib/data.ts);
types in [`lib/types.ts`](lib/types.ts). Identity, chat, alert dismissals, and
admin-posted alerts persist per-device in `localStorage`. Several features are
deliberately scaffolded with a clean seam for a backend — see **Backend seams**.

## The tabs

| Route | File | Status |
|---|---|---|
| `/` | [`app/page.tsx`](app/page.tsx) | Home — **kept lean**, in priority order: the hero MLR logo, the Family Fest spotlight **call-out stack** ([`HomeSpotlight`](components/HomeSpotlight.tsx) → [`CalloutStack`](components/CalloutStack.tsx): the [`FamilyFestSpotlight`](components/FamilyFestSpotlight.tsx) is the permanent base, temporary call-outs stack on top as swipe-away cards — see **Home call-out stack**), nearest-event spotlight + RSVP ([`UpcomingEvents`](components/UpcomingEvents.tsx)), **Get involved** ([`HomeGetInvolved`](components/HomeResortGroups.tsx) — Events/Work Weekends · Committees), **Ask for Help + People** side-by-side tiles ([`HomeHelpPeople`](components/HomeHelpPeople.tsx)), **Around the resort** ([`HomeAroundResort`](components/HomeResortGroups.tsx) — Cabin Stay · Local Places), an "App & help" group, one-line heritage |
| `/activities` | [`app/activities/page.tsx`](app/activities/page.tsx) | Resort activities grouped by category |
| `/family-fest` | [`app/family-fest/`](app/family-fest/) | **Family Fest section** (its own `.ff-section` theme + [`FamilyFestNav`](components/FamilyFestNav.tsx) sub-nav). Overview ([`page.tsx`](app/family-fest/page.tsx): poster + [`FestStatus`](components/FestStatus.tsx) + next-up) · `schedule` (+ anytime [`THINGS_TO_DO`](lib/data.ts) & `schedule/[id]` detail) · `dinners` (+ `dinners/[id]`) · `crew` ([`CrewView`](components/CrewView.tsx)) · `photos` ([`PhotosView`](components/PhotosView.tsx)) · `pay` ([`PayView`](components/PayView.tsx)) |
| `/chat` | [`app/chat/page.tsx`](app/chat/page.tsx) | Resort chat ([`ChatView`](components/ChatView.tsx)), tied to identity |

**Posts feed** ([`PostsView`](components/PostsView.tsx)) supports `@mentions` in
**comments** as well as the existing post tagging — the comment box has inline
`@name` autocomplete over the whole member list, mentions persist in
`post_comment_mentions` (migration [`0022`](supabase/migrations/0022_post_comment_mentions.sql),
public-read like comments), and `@name` renders highlighted (shared
`MentionText` helper, mirrors the chat).

**Committee chat** ([`CommitteeChat`](components/CommitteeChat.tsx)) `@mentions`
are scoped to **that committee's roster only** — you can only tag people who can
see the room (Beautification members can tag Beautification members, etc.).
Reactions show **who reacted**: tapping a reaction pill expands an inline list
of the people behind that emoji (resolved from the room roster, "You" for
yourself), mirroring the Posts feed — reacting itself stays on the long-press
tray. Same behavior in [`HouseChat`](components/HouseChat.tsx). Messages can also
be **edited or deleted within 24h** by their author (admins
anytime); delete is a **soft delete** — it stamps `committee_messages.deleted_at`
and the bubble (and any reply that quotes it) becomes a **"message deleted"**
tombstone for everyone, regardless of who removed it; edits stamp `edited_at` and
show a subtle "edited". The 24h-author / admin-anytime rule is enforced in RLS,
not just the UI (migration [`0023`](supabase/migrations/0023_committee_message_edit_delete.sql)).
| `/notifications` | [`app/notifications/page.tsx`](app/notifications/page.tsx) | **Activity** tab (bell icon) — a per-member Notifications feed ([`NotificationsView`](components/NotificationsView.tsx)). Members only |
| `/people` | [`app/people/page.tsx`](app/people/page.tsx) | **People** — the member directory ([`PeopleDirectory`](components/PeopleDirectory.tsx)): everyone with an account, searchable, each with a quick Text / Call / pay bar + tap-through to their full profile ([`MemberSheet`](components/MemberSheet.tsx)), plus **email a group** ([`EmailMembersSection`](components/EmailMembersSection.tsx)). **Not a tab** — reached from the People tile on Home ([`HomeHelpPeople`](components/HomeHelpPeople.tsx)) |
| `/profile` | [`app/profile/page.tsx`](app/profile/page.tsx) | Identity, email-alert opt-in, in-app notification prefs ([`NotifPrefs`](components/NotifPrefs.tsx)), admin alert + notification composers, sign out. **The last bottom tab** (👤) — it moved back here from the header avatar, which was removed |
| `/dining` | [`app/dining/page.tsx`](app/dining/page.tsx) | Dining + amenities (linked from Home, not a tab) |
| `/local-places` | [`app/local-places/page.tsx`](app/local-places/page.tsx) | **Local Places** — nearby businesses with quick Menu/Order/Call/Website links ([`LocalPlaceCard`](components/LocalPlaceCard.tsx)), data in [`lib/places.ts`](lib/places.ts); linked from Home. Inshalla hands off to the in-app `/tee-times` screen |
| `/events` | [`app/events/page.tsx`](app/events/page.tsx) | **Events** — the resort calendar + RSVP. Every upcoming gathering with a Going / Maybe / Can't-make control ([`AttendanceControl`](components/AttendanceControl.tsx)), a tap-through to who's coming + a per-day drill-down for Family Fest ([`EventSheet`](components/EventSheet.tsx)); admins create/edit ([`EventComposer`](components/EventComposer.tsx)). Linked from Home; nearest event is also spotlighted on Home ([`UpcomingEvents`](components/UpcomingEvents.tsx)). See **Resort events & attendance** |
| `/help` | [`app/help/page.tsx`](app/help/page.tsx) | **Help & how-to** — non-technical onboarding: what the app is, browse-vs-sign-in, "I didn't get my code" troubleshooting, add-to-home-screen ([`InstallButton`](components/InstallButton.tsx)), a **text-size control** ([`TextSizeControl`](components/TextSizeControl.tsx)), and a **"Take a quick tour"** link to the guided-tour walkthrough ([`/guide`](app/guide/page.tsx) — an in-app viewer that embeds `public/mlr-app-guide.pdf`, the portrait presenter/onboarding deck, keeping the TabBar + a Back button so it's never a dead-end; also surfaced as its own card in Home's "App & help" group). Leads with a human escape hatch (text/email `HELP_CONTACT` in [`lib/help.ts`](lib/help.ts)). Linked from Profile + the sign-in sheet. Not a tab |

Bottom nav: [`components/TabBar.tsx`](components/TabBar.tsx) (the `TABS` array
is the single source of truth for routes + labels + icons): Home · Feed ·
Family Fest · Activity · **Profile** (👤). (Profile moved back to a tab from the
old header avatar; People moved off the bar to a Home tile.)

Top app chrome: [`components/AppHeader.tsx`](components/AppHeader.tsx) — on
**Home only**, the **green MLR cabin logo centered** (`/brand-logo-green.png` —
the same mark as the opening splash, *not* the stylized wordmark) linking Home.
There is no header avatar and no bar on the other tabs (they carry their own
titles/back-links, and Profile is a bottom tab), so nothing floats across them.
Gated by the `usePathname() === "/"` check in `AppHeader`. Tagged `id="app-logo"`
so the splash can land on it (on a non-Home cold open it isn't present, so the
splash just clears — the fly is a Home thing). The logo is a **responsive
hero**: a viewport-derived `clamp()` (the `#app-logo` rule in
[`app/globals.css`](app/globals.css)) is the no-JS baseline, and an effect in
`AppHeader` **refines it against the live layout** — it measures the marked
anchor card and sizes the logo so it lands ~12px above the tab bar. The anchor
is **dynamic**: normally the Ask-for-Help / People row (`[data-fit-anchor]`,
[`HomeHelpPeople`](components/HomeHelpPeople.tsx)), with the "Around the resort"
group just past the fold — **but when Home has no upcoming events** (the
`[data-home-events]` block in [`UpcomingEvents`](components/UpcomingEvents.tsx)
renders nothing) it drops to the "Around the resort" group
(`[data-fit-anchor-empty]`, [`HomeAroundResort`](components/HomeResortGroups.tsx))
so the logo **shrinks to show it** instead of ballooning to fill the freed
space. It fits at load / when the beta tile resolves / on viewport
change, **not** on live reflow — so opening an accordion just scrolls. Shrinks to
the old `h-16` on short screens (SE).

App-open splash: [`components/SplashIntro.tsx`](components/SplashIntro.tsx) pops
the green logo center-screen, then **flies + zooms it into the header's
`#app-logo` slot** (a measured FLIP translate/scale). The header logo is held
hidden for the whole splash (`html[data-splash] #app-logo { opacity: 0 }` in
[`app/globals.css`](app/globals.css), kept laid out so it stays measurable) and
revealed the instant the fly lands — so the logo reads as *placed* into the
header, not cross-faded against a second copy. `splash-wash` is the CSS-only
self-clear fallback; reduce-motion skips straight to the app (attribute never
set, header logo shows normally).

## Non-technical / accessibility UX

Built for a family of mixed ages, so the rough edges that stop the least
technical members are smoothed:

- **Sign-in (`SignInGate` in [`IdentityProvider`](components/IdentityProvider.tsx))** — passwordless email-OTP with a **"check your spam"** hint, a **Resend code** button (30s cooldown so taps can't trip Supabase's rate limit), plain-language error mapping (`friendlyAuthError`), and a "Need help signing in?" link to `/help`. Code input is 6 digits (matches Supabase's default). Every sign-in entry routes through `promptSignIn()`, so that's the one chokepoint for sign-in gating.
- **"Add it first, sign in once" nudge** ([`InstallFirstNudge`](components/InstallFirstNudge.tsx)) — on **iOS**, Safari and the installed Home-Screen PWA keep **separate** logins, so a guest who signs in *in the browser* then adds MLR later has to sign in a **second** time in the icon app. So `promptSignIn()` intercepts when `isIos() && !isStandalone()` and shows this interstitial first (prominent "Add to Home Screen" → `requestInstall()` opens the same `InstallHint` walkthrough — there's no one-tap install API on iOS; plus a "Sign in here anyway" that falls through to `SignInGate`). Gated to iOS because Android/desktop installed PWAs reuse the browser session — no double sign-in to warn about.
- **Install** — [`InstallHint`](components/InstallHint.tsx) is the single install authority: the iOS first-run nag **plus** on-demand install via `requestInstall()` ([`lib/install.ts`](lib/install.ts)). On Android/desktop Chrome it fires the captured native `beforeinstallprompt`; on iOS it opens the Safari walkthrough. [`InstallButton`](components/InstallButton.tsx) (Home, Profile, Help) is the re-entry point — it self-hides once installed.
- **Welcome** — [`WelcomeCard`](components/WelcomeCard.tsx) shows once per device on Home, orienting newcomers to browse-first + no-password sign-in.
- **First-run member onboarding** — [`WelcomeIntro`](components/WelcomeIntro.tsx) is a guided two-step sheet that pops the first time a **brand-new** member verifies their sign-in code, when their profile is still essentially empty (only the name they typed at signup). **Step 1** welcomes them and collects the basics inline — phone, birthday, preferred payment — so they never have to discover Settings; **step 2** explains push and drops them into the real [`PushToggle`](components/PushToggle.tsx) settings (master on by default → untick what they don't want), then lands them on Home. It's gated by `IdentityProvider` `needsIntro` (`profiles.intro_seen` false **and** the profile is sparse), computed in a **separate, guarded** query so a pre-migration column never breaks sign-in. It deliberately **supersedes the standalone [`PushPrompt`](components/PushPrompt.tsx)** (which now holds off while `needsIntro`, and reaching the push step stamps `push_prompted` so nobody is asked twice). Migration [`0045`](supabase/migrations/0045_member_intro.sql) adds `profiles.intro_seen` (new accounts default false; existing members backfilled true so the current family isn't re-onboarded).
- **Text size + zoom** — [`TextSizeControl`](components/TextSizeControl.tsx) overrides the `<html>` rem root (17/19/21px); a boot script in [`layout.tsx`](app/layout.tsx) re-applies the saved choice before paint. Pinch-zoom is now allowed (viewport `userScalable: true`, was disabled). `body` uses `font-size: 1rem` so the override scales the whole app — **don't re-pin a px font-size on `body`/`html`** or you break it.
- **Sign-in walls** ([`Guard`](components/Guard.tsx), `CommitteeJoin`, `CommitteeChat`) carry a "just your name & email, no password" reassurance.

## Committees & account linking

Committee rosters are **static** in [`lib/data.ts`](lib/data.ts) `COMMITTEES`
(see also `FAMILY_FEST_AREAS`). The real data is **Family Fest** — one committee
where each person's `roles[]` are the **areas** they own (Meals · Entertainment &
Games · Art & Decorating · Merchandise, Fundraising & Polling · Logistics,
Scheduling & Finance); a trailing `" · Lead"` on a role marks that area's lead.
The roster renders via [`CommitteeRoster`](components/CommitteeRoster.tsx): a
role-based committee is laid out **grouped by area** (Lead pinned on top); other
committees get a flat list; an **empty roster renders nothing** (so it never
shows a misleading "no members" next to the account-membership card). Most people
**have no account yet**, so `CommitteeMember.email`/`phone` (and `Chef.phone`,
`ScheduleEvent.start`) are **optional** — contact controls
([`CommitteeMemberContact`](components/CommitteeMemberContact.tsx),
`CommitteeJoin`, dinner/schedule leads) self-hide when there's no number, and
`formatTime()` renders **"TBD"** for a missing time.

**Two distinct rosters — don't confuse them.** (1) The **static display roster**
above (`COMMITTEES`, public, includes account-less people). (2) The Supabase
**`committee_members`** table — account-only membership that gates **chat**,
managed by leads/admins via [`CommitteeMembers`](components/CommitteeMembers.tsx)
and readable only by that committee's members (RLS, [`0012`](supabase/migrations/0012_committees.sql)).
They count different things, so an admin can see e.g. "[2] members" (DB chat
membership) alongside a different static roster — that's expected, not a bug.

**Area validation + self-service (migration [`0073`](supabase/migrations/0073_committee_area_validation.sql)).**
Every area value that gets persisted (`request_to_join`, `review_join_request`,
`set_committee_areas`) is checked against a real allow-list
(`committee_areas`, seeded from `FAMILY_FEST_AREAS`) — "general"/"General" is
always rejected since that word is reserved for the committee-wide default
channel (area `IS NULL`, [`0063`](supabase/migrations/0063_committee_area_chats.sql)),
never a real role. This closes the gap that let a bad `area = "general"` land
in a join request with no UI ever having offered it. A **member already in the
committee** can add/remove their own areas with **no admin approval** via the
new `set_my_committee_areas` RPC (UI: `CommitteeJoin`'s "Your areas" editor,
member state) — it can't self-appoint `"· Lead"`. **Only someone not yet in the
committee** needs `request_to_join` → Lead/admin approval, for any area(s) they
want. `leave_committee` now also unlinks the caller's `committee_roster` row
(was `committee_members`-only, which stopped mattering for access once
[`0057`](supabase/migrations/0057_roster_is_membership.sql) made the roster the
real gate — leaving silently didn't revoke chat access until this fix).

**Account linking (no duplicate slot).** `CommitteeRoster` resolves each static
slot to a real account by **email** (`profiles.contact_email`, which Supabase
seeds from the login email on signup; profiles are public-read) with a
[`nameMatches()`](lib/committees.ts) fallback. A linked slot renders the
**account** (avatar + current display name + tap-through to the profile) instead
of the placeholder, so a person **upgrades in place** when they sign up — one
slot per person, no duplicate. The link is **stamped in the DB**, not just the
UI: a `SECURITY DEFINER` trigger keeps `committee_roster.linked_user_id` in sync
with `profiles.contact_email` (the verified login email) in **both directions** —
from the *profiles* side when someone verifies (migration
[`0056`](supabase/migrations/0056_committee_roster.sql)) and from the *roster*
side when an admin adds/edits a slot's email to one that already has an account
(migration [`0060`](supabase/migrations/0060_committee_roster_link_both_directions.sql),
trim/case-insensitive). Because membership + chat key off `linked_user_id`
([`0057`](supabase/migrations/0057_roster_is_membership.sql)), the upgrade also
grants committee access. Email is the only **auto**-link key — the
[`nameMatches()`](lib/committees.ts) fallback stays **display-only** (never
stamps the link), so a slot only auto-replaces when the signup email matches its
roster email (a no-email slot or a mismatched signup email needs an admin to
"pick a member"). ⚠️ The roster emails ship in the **client bundle** (needed for
both the link key and `mailto:`); consistent with the app's existing "seed
contact ships in the bundle" posture (see the privacy wall note) — display is
still gated behind sign-in.

**No name badge** — there used to be a tiny committee emoji tag next to a
person's name throughout the app (`CommitteeBadge`, keyed off the roster via a
`committeesForName()` helper); it was **removed**, so names now render plain
everywhere (People directory, `MemberSheet`, Posts + comments, committee/house
chat, the committee roster). The roster-name matcher that survives is
[`nameMatches()`](lib/committees.ts), used only for **account linking** (mapping a
static roster slot to a real profile), not for any badge.

## Houses (scoped chat + work items)

A **House** is a group members are designated into (e.g. "MJT House"). Each member
belongs to **at most one house** — modeled as a single `profiles.house_id` FK
(migration [`0064`](supabase/migrations/0064_houses.sql)), not a roster/membership
table like committees, because the relationship is one-per-person. **MLR is the
universal baseline**: everyone is always MLR and always sees resort-wide content; a
house is a *narrower* group layered on top, never a replacement. Assignment is
**admin-only** — `house_id` is deliberately kept out of the client update allowlist
(same escalation guard as `is_admin`), so the only write path is the
`set_member_house(target, hid)` RPC. The gate every house feature leans on is
`is_house_member(hid)` (admin OR `profiles.house_id = hid`), a `SECURITY DEFINER`
mirror of `is_committee_member` but simpler (a house is one room, no areas).

- **House chat** — a private, full-parity room per house (media/reactions/
  @mentions/replies/24h edit+soft-delete/unread), mirroring committee chat.
  Tables + RLS gated on `is_house_member` in migration
  [`0065`](supabase/migrations/0065_house_chat.sql) (`house_messages` +
  `house_message_media`/`_reactions`/`_mentions` + `house_reads`; `mark_house_read`
  RPC; an `@mention → chat_mention` notification trigger deep-linking
  `/posts?house=<slug>&m=<id>`). UI is [`HouseChat`](components/HouseChat.tsx) — a
  near-copy of [`CommitteeChat`](components/CommitteeChat.tsx) minus the area
  sub-scoping. **Surfaced as a channel in the Feed tab**
  ([`FeedView`](components/FeedView.tsx)): your house appears right after "Main
  Feed", above committee channels, with its own last-message/unread summary. Unlike
  committees, houses are **admin-assigned** — there's no request-to-join; a
  non-member sees a "ask an admin to add you" lock.
- **Scoped work items** — the checklist ([`WorkChecklist`](components/WorkChecklist.tsx))
  now sections by scope: `work_items.house_id` is `null` for **MLR** (resort-wide,
  everyone incl. guests — the old public-read behavior) or a house id for a
  **house-only** item (migration [`0066`](supabase/migrations/0066_work_item_house_scope.sql)
  swaps the `using(true)` read policy for `house_id is null or is_house_member(...)`).
  A house member sees an **MLR** section + their **house** section in one card; the
  RPCs (`create_work_item`/`mark_work_item_done`/`update_work_item`) were re-threaded
  with `p_house_id` and gate house writes on membership.
- **Work-item media** — every work item (MLR and house) can carry photo/video
  attachments (migration [`0067`](supabase/migrations/0067_work_item_media.sql),
  `work_item_media`, `add_work_item_media`/`remove_work_item_media` RPCs). The
  composer ([`WorkItemComposer`](components/WorkItemComposer.tsx)) reuses the shared
  upload pipeline (`uploadToMini` with `category:"work"`, `useMediaPicker`) and a new
  shared renderer [`MediaGrid`](components/MediaGrid.tsx) (extracted from PostsView's
  inline carousel/lightbox) displays them; `Media` type now lives in
  [`lib/media.ts`](lib/media.ts).
- **Work-item comments** — every work item (MLR and house) has a plain-text
  comment thread with `@mentions` (no reactions/media), so a task can hold a little
  Q&A (the requestor asks, others reply). Migration
  [`0068`](supabase/migrations/0068_work_item_comments.sql): `work_item_comments` +
  `work_item_comment_mentions`, RLS that **follows the parent item's visibility**
  (MLR-public vs house-only via `is_house_member`), and two new Activity kinds
  `work_item_comment` (→ item creator + prior commenters) / `work_item_mention`
  (deep-link `/?work=<id>`), added to `notif_types` (default on). Tapping any row in
  [`WorkChecklist`](components/WorkChecklist.tsx) opens
  [`WorkItemSheet`](components/WorkItemSheet.tsx) (details + media + the thread);
  an Edit button appears there for **admins (any item) and the item's author
  (their own)** — the `update_work_item` RPC enforces the same author-or-admin
  rule server-side (migration [`0079`](supabase/migrations/0079_work_item_author_edit.sql));
  delete stays admin-only. (The composer moved off the row tap.) Mention
  candidates are scoped to who can see the item (everyone for MLR, house members for
  house items). Helpers in [`lib/workItems.ts`](lib/workItems.ts)
  (`fetchWorkItemComments`/`addWorkItemComment`/`removeWorkItemComment`; `fetchWorkItems`
  also returns `commentCount`).
- **Work-item urgency + standalone card** — each item carries an urgency rating
  (`work_items.urgency` ∈ `asap` | `this_year` | `nice_to_have`, migration
  [`0069`](supabase/migrations/0069_work_item_urgency.sql); `create_work_item`/
  `update_work_item` re-threaded with `p_urgency`). Shown as a colored chip
  (`URGENCY_META` in [`lib/workItems.ts`](lib/workItems.ts)) and the list is **always
  sorted by importance** (ASAP → This year → Nice to have → unrated, newest-first
  within each). The composer defaults new items to `this_year`. The **Work Checklist
  is now its own collapsed-by-default expandable card on Home**
  ([`app/page.tsx`](app/page.tsx), no longer nested in "Around the resort"): the
  header shows a live summary (incl. a `🔴 N ASAP` count) and toggles the list open.
- **New-work-item notifications** — adding a task fans out a `work_item_created`
  Activity notification (migration [`0070`](supabase/migrations/0070_work_item_created_notif.sql)):
  an MLR item notifies every member (resort-wide, like `new_post`); a house item
  notifies only that house's members + every app admin (mirrors the
  `committee_join_request` audience, 0042). Default **on**; toggle in Profile →
  Notifications → Work items (`NotifPrefs`). The actor is never notified of their
  own item. Also rides a **phone push** — `work_item_created` is a `PushType`
  (off by default, opt in via Profile → Notifications → Push, `PushToggle`) that
  the mini's [`push-sender.js`](media-server/push-sender.js) (web push) and
  [`apns-sender.js`](media-server/apns-sender.js) (iOS) both relay from the same
  feed row.
- **Admin** — Profile → Admin → **Houses** ([`AdminHouses`](components/AdminHouses.tsx)):
  create/rename/delete houses + assign each member (chips over the `admin_members()`
  directory, which was widened to return `house_id`/`house_name`).
  [`AdminMembers`](components/AdminMembers.tsx) shows each member's house as a chip.
- **House calendar + Hub** — a shared calendar of **stays** per house: one member
  says "I'm going up on these dates," so everyone sees who's staying and when, and
  overlapping stays show who's up at the same time. Resort-wide **MLR events** (the
  `events` table) are overlaid on the calendar so a house never misses a family-wide
  gathering. A stay's **added people** (spouse, kids, the dog, a friend) are a free
  list of names — no account needed; only the submitter has one. Migration
  [`0071`](supabase/migrations/0071_house_calendar.sql): `house_stays` (`house_id`,
  `created_by`, `title`, `start_date`/`end_date`, `guest_names text[]`, `note`),
  RLS read gated on `is_house_member`, SECURITY DEFINER `create_house_stay` /
  `update_house_stay` / `delete_house_stay` (member writes own; author-or-admin
  edits), and a `house_stay_created` Activity notification (→ the house + admins,
  default on, also a `PushType`). Surfaced via a **House Hub** — a Home card
  ([`HouseHubCard`](components/HouseHubCard.tsx), self-hides off-house) → `/house`
  ([`HouseHub`](components/HouseHub.tsx)) that gathers the house's **calendar, chat,
  and work-item to-do list** in one place; the full calendar (month grid + agenda)
  is `/house/calendar` ([`HouseCalendar`](components/HouseCalendar.tsx),
  [`HouseCalendarScreen`](components/HouseCalendarScreen.tsx)) with
  [`HouseStayComposer`](components/HouseStayComposer.tsx) /
  [`HouseStaySheet`](components/HouseStaySheet.tsx). Both routes are **non-dynamic**
  (static-export safe) and resolve the viewer's own house, or a `?house=<slug>`
  deep-link (admins can view any) via `useResolvedHouse` +
  [`useHouseCalendar`](lib/hooks.ts); client seam [`lib/houseCalendar.ts`](lib/houseCalendar.ts).
- Client seam: [`lib/houses.ts`](lib/houses.ts) (`fetchHouses`, `fetchMyHouse`,
  `setMemberHouse`, `saveHouse`/`deleteHouse`); types `House` + `HouseStay` +
  `WorkItemMedia` in [`lib/types.ts`](lib/types.ts).
- 📱 **iOS parity** — the native app (`mlr-app-ios`) has house **chat**,
  house-scoped **work items**, and now the **house calendar + Hub** (mirroring the
  same `house_stays` tables/RPCs, so both apps sync): `HouseStay` model,
  `HousesService` stay CRUD + realtime, `HouseCalendarView` (month grid + agenda),
  `HouseStayComposer`, `HouseHubView`, and a self-hiding House Hub card on Home.

## Identity, admins & alerts

- **Identity (on-demand, not a gate)** — the whole app is **public to browse**.
  [`components/IdentityProvider.tsx`](components/IdentityProvider.tsx) only asks
  for name + email when you try to *do* something (post in chat, RSVP, …): those
  actions call `promptSignIn()`, which opens a dismissible sign-in sheet.
  `useIdentity()` exposes `{ user, isAdmin, updateUser, promptSignIn, signOut }`
  (`user` is `null` while browsing as a guest). Identity is stored in
  `localStorage`, no verification yet; at sign-in the guest opts in/out of email
  alerts.
- **Admins** — strictly `profiles.is_admin` in Supabase; the database is the
  **single source of truth** (there is no client allow-list — it could only grant
  UI the server won't honor). The first admin is bootstrapped once from the SQL
  editor; after that admins promote each other in-app. Admins see, in
  Profile → Admin: the alert composer
  ([`AdminAlertComposer`](components/AdminAlertComposer.tsx)), the **member
  directory** ([`AdminMembers`](components/AdminMembers.tsx)) — promote/remove-admin
  *and* permanently remove a member — and **recent sign-ins**
  ([`AdminSignins`](components/AdminSignins.tsx)). Clients can't write `is_admin`
  (column-level grant in `0001`, insert guard in `0010`); admin-gated SECURITY
  DEFINER functions back the rest: `admin_members()` + `set_admin()`
  ([`0008`](supabase/migrations/0008_admin_members.sql)), `delete_member()` (hard
  delete via `auth.users` cascade; can't delete yourself or an admin —
  [`0009`](supabase/migrations/0009_admin_remove_member.sql)), and
  `recent_signins()` (GoTrue audit log + IP, geolocated client-side —
  [`0011`](supabase/migrations/0011_admin_signin_log.sql)). Each section shows a
  "run the migration" hint until its function exists. Admins can also **view as**
  a member or guest ([`PreviewAs`](components/PreviewAs.tsx) + floating
  [`PreviewBanner`](components/PreviewBanner.tsx)) — a device-local, UI-only
  `previewMode` override in `IdentityProvider` that re-renders the app as that
  role (to check the privacy wall); it never touches the real Supabase session.
- **Announcement banner** — [`components/AnnouncementBanner.tsx`](components/AnnouncementBanner.tsx)
  shows notices at the top of the app (server-fed seed +
  admin-posted alerts), dismissible per-device. Admin alerts also **auto-expire**
  so they don't sit at the top forever: the composer
  ([`AdminAlertComposer`](components/AdminAlertComposer.tsx)) picks a window
  (default **6h**, up to **30 days**) → stamped onto `Announcement.expiresAt` /
  `announcements.expires_at`, and the banner hides any notice past its expiry
  (people can still dismiss sooner with ✕; expired local alerts are pruned from
  `localStorage` on load). Migration
  [`0022`](supabase/migrations/0022_announcement_default_expiry.sql) gives the
  column a server-side 6h default; seed/legacy rows with no expiry never auto-hide.
- **Privacy wall (guests vs members)** — the app is still browsable, but sensitive
  info is gated behind sign-in via [`components/Guard.tsx`](components/Guard.tsx) +
  [`lib/privacy.ts`](lib/privacy.ts): `SignInWall` (whole-screen gate — wraps
  **Posts** and **Pay**), `Protected` (inline gate for a phone/email/location —
  guests get a "🔒 Sign in" chip), and `PrivateName` (full name for members,
  **first name only** for guests). `useGuest()` returns `guest = isSupabaseConfigured && !user`,
  so with no backend the app stays fully open (we never lock everyone out of an
  app that can't sign in); during prerender `user` is null, so the static HTML
  ships the gated/guest view. Applied to: Posts, Pay/dues, MemberSheet
  (contact+pay), schedule/dinner/committee detail pages (locations, chef/lead/member
  contacts, "houses on crew"), FestStatus/FestWeek (today's locations + contacts),
  DinnerCrew, CrewView (household names), CommitteeJoin. ⚠️ **This is the UI layer
  only** — sensitive seed data still ships in the client bundle and Supabase
  posts/profiles are still public-read; the real hardening (gated server reads +
  RLS lockdown, keeping PII out of the bundle) is the planned next step.

## Family Fest season (the "one app" spine)

Both apps share a phase model so Family Fest behaves as a season of the resort,
not a separate app — no backend needed:

- [`lib/festSeason.ts`](lib/festSeason.ts) — pure `getFestSeason(start, end)` →
  `{ phase: "off-season" | "planning" | "live" | "wrap", isLive, isPlanning,
  isWrap, isTakeover, daysUntilStart, isSoon, dayNumber, totalDays, daysSinceEnd,
  wrapDaysLeft }`, plus `toISODate()` and the `PLANNING_LEAD_DAYS` (60) /
  `WRAP_TAIL_DAYS` (14) window constants. **Mirrored byte-for-byte in the
  `family-fest` repo** (like the EVENT/FAMILY_FEST seed data) — edit both.
- [`lib/useFestSeason.ts`](lib/useFestSeason.ts) — client hook; computes the
  phase **on the client** (returns `null` until mounted → no hydration mismatch)
  so the live week is correct on the static Pages build *and* Vercel. A
  build-time `new Date()` would freeze the phase at deploy.
- Consumers: [`FamilyFestSpotlight`](components/FamilyFestSpotlight.tsx) (home —
  quiet banner → planning partial-takeover → live takeover hero → wrap "post
  your photos"), [`FestStatus`](components/FestStatus.tsx) (hub — countdown →
  "Day n of N + Today at the Fest" → wrap photo nudge), and
  [`TabBar`](components/TabBar.tsx) (live dot on the Family Fest tab during
  live + wrap).
- Dates come from `FAMILY_FEST.startDate` / `.endDate` in `lib/data.ts`.
- The §0b full code merge is unchanged/deferred; this is the lighter-touch
  "feels like one app" layer that ships before the backend.

## Family Fest dues calculator

`family-fest/pay` doesn't just list dues tiers — [`FestDuesCalculator`](components/FestDuesCalculator.tsx)
puts a +/- stepper on each tier and auto-fills [`PayView`](components/PayView.tsx)'s
Amount + Note (and so the Venmo deep link) from the picks, so "2 adults" turns
into the right dollar total without anyone doing the math. A tier is either
**flat** (one-time/full-week — just a headcount) or **`DuesTier.perDay`**
(e.g. "Adult (Per day)") — per-day tiers share one "how many days" stepper
(capped to the fest's actual length via `getFestSeason(...).totalDays`) since
a single payment assumes everyone in it is here for the same span; a
household with mixed day-counts just runs the calculator (Reset clears it)
and taps Pay again for the second group. `PayView`'s Amount/Note are now
**controlled by the parent** (`app/family-fest/pay/page.tsx`) instead of
owning their own state, specifically so the calculator can drive them —
typing directly into either field still works exactly the same. Data model:
migration [`0078`](supabase/migrations/0078_fest_dues_per_day.sql) adds
`fest_dues.per_day` (backfilled from existing `"...(Per day)"` labels); the
Planner's dues editor ([`FestPlanner.tsx`](components/FestPlanner.tsx)
`DuesSheet`) has a matching "Billed per day" checkbox.

## Home call-out stack

The Home "what's happening" slot is a **Robinhood-style swipe-away card stack**
so temporary call-outs (future news/alerts) don't push the
page down — keeping the **Ask for Help** row below always in view.
[`HomeSpotlight`](components/HomeSpotlight.tsx) assembles the stack and
[`CalloutStack`](components/CalloutStack.tsx) renders + animates it.

- **The base never moves.** Items are passed front-to-back: swipeable call-outs
  first (newest first), then the **permanent base** ([`FamilyFestSpotlight`](components/FamilyFestSpotlight.tsx),
  `swipeable: false`). You can swipe/✕ away every call-out but the base always
  stays — so the slot is one card tall no matter how many call-outs are active.
- **Swipe to dismiss.** The front card tracks a horizontal drag (axis-locked so
  vertical still scrolls the page, `touch-action: pan-y`); past a deliberately
  long ~140px throw it flings off and the next card slides up (the long
  threshold keeps a small drag/scroll jitter from dismissing). A small **✕** is
  the tap fallback, and a
  one-per-session **wiggle** (`.callout-wiggle` keyframe in
  [`globals.css`](app/globals.css), skipped under reduce-motion) hints it's
  swipeable. The cards still **behind** the front are implied by decorative
  "plates" (absolute `inset-0`, peeking a fixed sliver) so the stacked look is
  height-independent; only the front card's content is mounted.
- **Dismissals are session-scoped** — kept in `sessionStorage`
  (`mlr.callouts.dismissed`), keyed by each item's **id**. A swiped card stays
  gone while you move between tabs but **comes back the next time the app is
  opened** (a fresh session). Give a temporary call-out a *versioned* id (e.g.
  a date- or deadline-suffixed string) so a brand-new alert reappears even
  within a session where an old, same-purpose card was swiped.
- **Add a future call-out** by pushing another swipeable `StackItem` above the
  base in `HomeSpotlight`, gated by whatever decides it should show.

## Resort events & attendance

The resort calendar + a Facebook-style RSVP, backed by Supabase (migrations
[`0034`](supabase/migrations/0034_events.sql) `events` + admin RPCs,
[`0035`](supabase/migrations/0035_event_attendance.sql) `event_attendance` +
upsert RPC). Both tables are **public-read**; all writes go through
`security definer` RPCs (admins manage the calendar; a member writes only their
own RSVP) — the same shape as the cabin feature.

- **Events** are admin-managed DB rows merged with an in-code **seed**
  ([`RESORT_EVENTS`](lib/data.ts)) so the calendar has content out of the box.
  **Family Fest is deliberately NOT a DB row** — it's synthesized from
  `FAMILY_FEST` so its dates have one source of truth and stay tied to the season
  model. Merge + helpers live in [`lib/events.ts`](lib/events.ts); the shared data
  flow (load, realtime, optimistic RSVP, per-event summaries) is the `useEvents`
  hook in [`lib/hooks.ts`](lib/hooks.ts).
- **Attendance** keys on a **stable string event id** (the DB uuid, or a seed
  slug like `family-fest-2026`) — *not* a FK — so synthesized events carry RSVPs
  just like DB ones. `delete_event()` cleans up their rows by id.
- **Per-day drill-down:** multi-day events with `day_rsvp` (Family Fest) get an
  optional Sun–Sat picker; the `days` JSON map rolls up to the overall status —
  going at least one day reads as **Going** (`effectiveStatus()`).
- **Surfaces:** [`UpcomingEvents`](components/UpcomingEvents.tsx) spotlights the
  nearest event on Home (skips Family Fest while its own takeover spotlight is
  showing); [`/events`](app/events/page.tsx) is the full calendar.
  [`AttendanceControl`](components/AttendanceControl.tsx) /
  [`EventCard`](components/EventCard.tsx) /
  [`EventSheet`](components/EventSheet.tsx) /
  [`EventComposer`](components/EventComposer.tsx) reuse the existing sheet motion,
  Guard privacy wall (`PrivateName` masks guest names), and theme tokens.
- **Not in v1 (clean follow-ups):** new-event notifications + pre-event reminders
  (reuse `_notify` / `notif_types` / the mini push-sender, like cabin notifs); the
  Google-Calendar ICS feed (see Backend seams).

## Ask for Help (BETA)

A member who's **at the resort** posts a short request for a hand (moving logs,
setting up, a ride, supplies, or the rare 🚨 Urgent); members who opted into
**Willing to Help** *and* are also at the resort right now get an in-app
notification + phone push, can tap **On my way** (the only response), and see open
requests in a shared **log** ([`/help-requests`](app/help-requests/page.tsx) →
[`HelpRequestsView`](components/HelpRequestsView.tsx)). The requester says how many
people they need; once that many are on the way the request reads **✅ Covered** and
everyone eligible is told (so others don't bother). **Beta-gated** behind
`profiles.beta_tester` (entry: a self-hiding Home card
[`AskForHelpHomeCard`](components/AskForHelpHomeCard.tsx) + a Profile → Beta link;
the [`WillingToHelpToggle`](components/WillingToHelpToggle.tsx) opt-in lives there too).

- **Presence with no geolocation.** A PWA can't track location in the background,
  so "at the resort right now" is derived from data we already have: you're present
  if you're RSVP'd **going** to an event whose window **±2 days**
  (`EVENT_PRESENCE_GRACE_DAYS`, for early arrivals / lingering long weekends)
  includes today, **or** you have an **approved cabin stay** covering today. For
  day-RSVP events (Family Fest) on a real event day the per-day `days[today]` map is
  checked (a Mon–Wed attendee isn't pinged Thursday); on the ±2 grace shoulder days
  it falls back to "going at all" (lenient on purpose — better to over-ask than
  miss someone who's still around).
- **Targeting is client-snapshotted, server-resolved.** The client merges DB + seed
  events (Family Fest's dates live in code) to compute the live-event ids
  ([`helpTargeting`](lib/helpRequests.ts)) and passes them to `request_help`; the
  server resolves recipients via `_help_recipients` (willing + present + beta + the
  `help_request` notif pref) and re-checks the **requester** is present. It *trusts*
  the client's event-window snapshot — recomputing server-side would mean moving
  seed-event dates into the DB and would break the demo-date test override. That's an
  accepted beta trade-off; **GA hardening:** persist seed event windows + re-derive in
  the RPC (see the 0037 header).
- **Data flow** mirrors the cabin + events features: a public(member)-read table
  written only via SECURITY DEFINER RPCs (`request_help` → `(id, notified)`,
  `respond_to_help`, `withdraw_help`, `set_help_status`), AFTER-INSERT triggers that
  fan out via `_notify` (so it rides the in-app feed + the mini's push-sender once
  `help_request`/`help_response` are in `notif_types`/`push_types`/`PUSHABLE_FEED_TYPES`),
  a realtime [`useHelpRequests`](lib/hooks.ts) hook, and the
  [`AskForHelpSheet`](components/AskForHelpSheet.tsx) form (type · what · **what to
  bring** · how many · where + optional one-tap GPS pin · optional time · "notify
  everyone willing" escape hatch). Fulfillment is **race-safe** (conditional
  `update … where fulfilled_at is null` + `FOUND`). **Data model:** migration
  [`0037`](supabase/migrations/0037_help_requests.sql) (`profiles.willing_to_help`,
  `help_requests`, `help_responses`, the RPCs/triggers, + `help_request`/`help_response`
  added to `notif_types`/`push_types`). An open-request cap (10) is the only
  anti-spam guard for now.
- **"What to bring" checklist** (migration [`0046`](supabase/migrations/0046_help_bring_items_and_urgent_broadcast.sql)):
  a request can carry an optional list of things to bring (e.g. "2 long tables, 6
  chairs, 3 coolers") in `help_request_items`. Each line is a checkbox in the log;
  a helper taps the ones they're bringing (`claim_help_item()`, race-safe, one
  bringer per item), and claiming an item also records an "on my way" response so
  it counts toward the head-count. Shown in [`HelpCard`](components/HelpRequestsView.tsx)
  with a "n/N covered" tally.
- **Beta testing affordances** (migration [`0038`](supabase/migrations/0038_help_test_affordances.sql)):
  **admins bypass the requester presence gate** (post from anywhere to test/demo —
  the beta gate + recipient presence still apply, so use "Notify everyone willing"
  to reach people when off-season), and **beta-tester requesters get a self-ping**
  for their own request (`_notify` normally skips the actor) so it can be verified
  solo. Both fall away at GA (they key on `is_admin` / `beta_tester`).
- **Urgent goes to EVERYONE** (migration [`0046`](supabase/migrations/0046_help_bring_items_and_urgent_broadcast.sql)).
  A request with `category = 'urgent'` is an emergency, so it bypasses the
  willing + present + beta filters and alerts **every member app-wide** via a new
  `help_urgent` notification kind (default on, mutable in Profile → Notifications;
  `NotifPrefs`). `notif_on_help_request` branches: urgent fans `help_urgent` out to
  all profiles (gated only by their `help_urgent` pref); everything else still uses
  `_help_recipients` (willing + present). The "✅ covered" fan-out branches the same
  way. The mini's push-sender treats `help_urgent` as an **override push** — anyone
  whose phone push is on (non-empty `push_types`) gets buzzed regardless of their
  per-category picks (so it isn't gated on `push_types` membership like the other
  feed pushes). Non-beta members can also **respond to / help with** an urgent
  request (`respond_to_help` + `claim_help_item` waive the beta gate for urgent).
  Non-urgent types keep the willing + present targeting and the beta gate.

## Content safeguards (feed moderation)

Layered safeguards on the social surfaces (Posts + comments + uploaded media) so
sensitive/inappropriate/illegal content doesn't sit in front of the family. Full
writeup + the on-device Apple "Tier 2" plan in
[`docs/content-moderation.md`](docs/content-moderation.md). Posts stay
**post-moderated** (still go live instantly) but anything a filter trips is
**held for admin review** — a `status` of `visible | pending | hidden` on
`posts`/`post_comments`; RLS only returns non-`visible` rows to the author +
admins, so held/removed content drops out of the public feed without being
destroyed. **Live now (Tiers 0+1):**
- **Tier 0 (deterministic):** the mini's `/upload` sniffs **magic bytes** and
  rejects anything that isn't really an image/video ([`media-server/server.js`](media-server/server.js)
  `sniffMediaKind`); text length caps + an admin-managed **blocklist** auto-hold
  matching captions/comments (a Postgres trigger — the always-on "language" floor,
  no mini needed); client pre-checks in [`lib/moderation.ts`](lib/moderation.ts).
- **Tier 1 (human):** members **Report** posts/comments
  ([`ReportButton`](components/ReportButton.tsx) → `report_content` RPC); ≥2
  distinct reports auto-hold an item; admins work a review queue
  ([`AdminModeration`](components/AdminModeration.tsx) in Profile → Admin →
  Content review) with Approve/Remove (`set_content_status`). Members can't change
  their own item's status (a `BEFORE UPDATE` guard), so editing can't un-hide.
  Every action is audited in `content_moderation_events`.
- **Tier 2 (on-device Apple, planned, mini-only):** `SensitiveContentAnalysis`
  for nudity in images + sampled video frames, and `FoundationModels` for
  context-aware text — wired into `fm-service`. **No CSAM API exists for third
  parties** and **PCC is unattainable**; both run on-device. See the doc.

Data model: migration [`0040`](supabase/migrations/0040_content_moderation.sql)
(`status` columns + status-aware RLS, `moderation_blocklist`, `content_reports`,
`content_moderation_events`, the `moderate_content_text`/`apply_content_report`
triggers, and the `report_content`/`set_content_status`/`moderation_queue` RPCs).

## Backend seams (planned, not yet wired)

These are built UI-first with the swap point isolated to one module each:

| Feature | Seam today | Becomes |
|---|---|---|
| Google-Drive-fed announcements | [`lib/announcements.ts`](lib/announcements.ts) `getAnnouncements()` | server route reading a Drive file (API or published CSV/JSON), revalidated / webhook-pushed |
| Google-Calendar events feed | [`lib/events.ts`](lib/events.ts) `fetchGcalEvents()` (returns `[]`) | fetch + parse a **published Google Calendar ICS** (`NEXT_PUBLIC_GOOGLE_CALENDAR_ICS_URL`, no OAuth) → `ResortEvent[]` (`source: "gcal"`), merged in `fetchEvents()` |
| Email OTP / magic link | `IdentityProvider` sign-in | verify email before `setUser` |
| Shared chat | [`components/ChatView.tsx`](components/ChatView.tsx) (localStorage) | shared DB + realtime/poll |
| Admin alerts → broadcast | [`lib/localAnnouncements.ts`](lib/localAnnouncements.ts) | server validates admin, broadcasts, **emails opted-in guests**, web-push for Android |
| Email alerts opt-in | `user.emailAlerts` flag | mail provider (Resend/SendGrid) sends on alert |

A single backend (e.g. Supabase: email OTP auth + Postgres + realtime, or
Vercel Postgres/KV + Resend + web-push) can cover all of these.

**Push notifications (shipped).** Web push for chat messages + broadcast alerts,
on Android *and* iOS (iOS requires the app added to the Home Screen / standalone
PWA — iOS 16.4+). Pieces: a minimal [`public/sw.js`](public/sw.js) service worker
(push + notificationclick only, no caching), client helpers in
[`lib/push.ts`](lib/push.ts) (permission + `pushManager.subscribe` →
`push_subscriptions`), a per-user level in Profile → Notifications
([`PushToggle`](components/PushToggle.tsx): all / mentions / alerts / off, stored
as `profiles.push_level`), and the sender on the mini
([`media-server/push-sender.js`](media-server/push-sender.js)) that listens to
Supabase realtime and delivers via the `web-push` lib. **Env:**
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the app; `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
/ `VAPID_SUBJECT` (+ existing `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`) on the mini.
**Data model:** migration [`0019`](supabase/migrations/0019_push_notifications.sql)
adds `profiles.push_level` + the `push_subscriptions` table (RLS: own-rows). All
of it is dormant/no-op until the VAPID keys are set, so the app builds and runs
without them.

**In-app Notifications (the Activity tab).** A durable, Facebook-style feed of
everything that happened involving you — comments & reactions on your posts,
@mentions in posts/comments, @mentions in committee chat, new Feed posts,
committee approve/decline, **committee join *requests* (to that committee's leads
+ every app admin — migration [`0042`](supabase/migrations/0042_committee_join_request_notif.sql))**,
**new members joining the resort (admins, feed-durable — migration
[`0062`](supabase/migrations/0062_new_member_notification_feed.sql); previously
push-only via the mini, so a missed realtime window left no trace)**,
**cabin-stay requests (admins) & decisions (requester)**, and admin broadcasts.
Every kind has its own on/off toggle in Profile → Notifications
(`profiles.notif_types`); the mini's push-sender checks the same `notif_types`
for cabin pushes, so one switch controls feed + push. The join-request kind
(`committee_join_request`) and the new-cabin-request kind are **admin-gated in the
prefs UI** (only admins see the toggle, since they're the audience); admins can
additionally opt the join-request into a **phone push** (it's in
`PUSHABLE_FEED_TYPES` + the admin-only `PushToggle` row, off by default).
**Independent of push** (it
works even if the mini is down; the chat firehose stays out — only chat
@mentions land here). Pieces: the [`/notifications`](app/notifications/page.tsx)
route → [`NotificationsView`](components/NotificationsView.tsx); the bell tab +
live unread **badge** in [`TabBar`](components/TabBar.tsx) via
[`useUnreadNotifications`](lib/hooks.ts); per-member kind prefs
([`NotifPrefs`](components/NotifPrefs.tsx) → `profiles.notif_types`); and an admin
sender ([`AdminNotificationComposer`](components/AdminNotificationComposer.tsx) →
`send_broadcast_notification`) that targets **Everyone / Beta testers / Admins**
(with an optional banner mirror for Everyone). **Read model:** `seen_at` drives
the badge (opening the tab clears it), `read_at` drives per-item bold, `expires_at`
drops an item from the badge while keeping it in the list. **Beta Tester** is a new
admin-assigned role (`profiles.beta_tester`, toggled in
[`AdminMembers`](components/AdminMembers.tsx)) used to dry-run notifications.
**Data model:** [`0029`](supabase/migrations/0029_beta_tester_and_notif_prefs.sql)
(`beta_tester`, `notif_types`, `set_beta_tester`) +
[`0030`](supabase/migrations/0030_notifications_feed.sql) (the `notifications`
table, fan-out triggers on the source tables, and the `mark_*` /
`send_broadcast_notification` RPCs). Rows are written **only** by SECURITY DEFINER
triggers/RPCs (no client insert); members can read/dismiss their own.

**Mac-mini media server** ([`media-server/`](media-server/)) also now
**transcodes uploaded videos** to web-friendly ≤1080p H.264 MP4 via `ffmpeg`
([`transcode.js`](media-server/transcode.js)) — photos are left full quality —
and hosts the optional [`alert-mailer.js`](media-server/alert-mailer.js) +
[`push-sender.js`](media-server/push-sender.js) side jobs alongside uploads.
The AI moderation path ([`moderation.js`](media-server/moderation.js)) uses
`sharp` to downscale a **copy** of each image/sampled video frame to ≤1024px
before base64 — the local `fm serve` classifier caps the request body at 1 MB, so
full-res phone photos would otherwise 413. The stored/served media is untouched.

## AI Assistant ("Ask MLR")

A signed-in convenience bot (floating ✨ button → [`AssistantButton`](components/AssistantButton.tsx)
→ [`AssistantChat`](components/AssistantChat.tsx) on `Sheet`) that answers
questions from app data the member can already see — schedule, who's in charge,
contacts, locations, "where do I find this?". **Off by default for everyone.**
The button shows only when you're a **Beta Tester** (`profiles.beta_tester`) **and**
you've turned it on in Profile → Beta features ([`AssistantToggle`](components/AssistantToggle.tsx),
a per-device localStorage switch via [`lib/assistantToggle.ts`](lib/assistantToggle.ts),
default off; the toggle itself only renders for beta testers). **Two hard
guarantees:** (1) **signed-in only** (beta implies signed-in; `askAssistant`
refuses guests; the future server route re-checks the Supabase token), and (2)
**chats are never a source** — resort/committee chat are absent from retrieval by design;
**posts** (public to any signed-in member) are the only sanctioned social source
(allow-listed, not yet wired). So the privacy bar is just "signed-in + no chats"
— it does *not* depend on the larger RLS hardening.

Pipeline lives in [`lib/assistant/`](lib/assistant/): `index.ts` (`askAssistant`
orchestrator — sign-in gate, 500-char cap), `intent.ts` (pure `classifyIntent` /
`resolveDay`), `retrieval.ts` (the **allow-list** over static `lib/data.ts` —
`SOURCE_ALLOWLIST`, chats excluded), `generate.ts` (the single swappable model
seam + system prompt). It runs **client-side today** (all v1 data is static, so
nothing new is exposed) and drops into a `POST /api/assistant` route unchanged.

**Model is swappable behind `generateAssistantAnswer()`.** With none wired it
answers via a deterministic *grounded stub* (no invention; assembled from the
retrieved records). Otherwise it points `ASSISTANT_FM_URL` at **Apple Foundation
Models** running in a small Swift service on the Mac mini
([`media-server/fm-service/`](media-server/fm-service/)) — Apple's models only run
on Apple devices, so generation lives on the mini while orchestration stays on
Vercel (contract: `POST {system,question,context} → {answer,model}`). On **macOS
27** the service is wired to prefer Apple's **Private Cloud Compute** model (far
more capable, ~32K context) with on-device fallback, decided by a startup probe.
⚠️ But PCC *inference* is entitlement-gated and **currently not attainable**: it
fails with `ModelManagerError 1046`; the only third-party capability is the
**request-only** `com.apple.developer.foundation-model-adapter` (for custom
adapters), a **free Personal Team can't get it** (Xcode provisioning rejects it
verbatim), and even a legit Xcode dev signature (`get-task-allow`) doesn't bypass
the gate. Enabling it would need a paid membership + an Apple-approved entitlement.
So the bot runs **on-device** today; the probe auto-switches to PCC if it ever
becomes reachable. Full findings in [`media-server/fm-service/README.md`](media-server/fm-service/README.md).
Also note: `swift build` on the current CLT beta needs a `DYLD_FALLBACK_FRAMEWORK_PATH`
workaround (README). The `/api/assistant` route ships **Vercel-only** (a POST
handler breaks the Pages `output: export`); its wrapper + env vars are in
[`docs/ai-assistant.md`](docs/ai-assistant.md).

## Conventions

- **Theme** — all colors are CSS variables in the `@theme` block of
  [`app/globals.css`](app/globals.css). Tailwind v4 turns each `--color-*` into
  `bg-*` / `text-*` / `ring-*` / `border-*` utilities. Never hard-code hex in
  components; add or edit a token. Palette: `--color-primary` = forest green
  (`#15503a`, the logo), `--color-accent` = vintage chestnut, on a near-white
  page. The resort wordmark uses `.font-script` (Yellowtail, via next/font).
  `--color-fest` is the Family Fest heraldic wine for fest-branded accents
  *outside* `.ff-section` (e.g. the TabBar's Family Fest tab + live dot).
  - ⚠️ **LIGHT MODE ONLY — never add a dark theme.** And **never** use a dark
    translucent surface tint (`bg-black/NN`, `bg-zinc-*/NN`) as a card/panel bg —
    it goes muddy grey on light (a recurring issue across the author's apps).
    Translucent layers stack LIGHT; `bg-black/NN` is OK only as a modal scrim.
- **Cross-nav** — the **Family Fest** bottom tab → `/family-fest` overview, then
  the in-section [`FamilyFestNav`](components/FamilyFestNav.tsx) sub-nav switches
  between Schedule / Dinners / Crew / Photos / Pay. All internal routes — no
  external hop. (The §0b merge is now done; identity stays per-app localStorage
  until the Supabase phase.)
- **Family Fest theme scoping** — the FF section's parchment/Renaissance palette
  + Cinzel serif are scoped to `.ff-section` (see `app/globals.css` and
  [`app/family-fest/layout.tsx`](app/family-fest/layout.tsx)): the wrapper
  re-declares the `--color-*` / `--font-display` variables that Tailwind's
  utilities read, so only that subtree changes. Don't hard-code hex.
- **Sheets/overlays** — build on [`components/Sheet.tsx`](components/Sheet.tsx)
  (scrim + slide-up panel + grab handle + close button + safe-area footer; also
  exports `SectionLabel` and the `FIELD` input class) paired with
  `useSheetDismiss` in [`lib/hooks.ts`](lib/hooks.ts) (close animation + Escape
  + reduce-motion). `EventSheet` / `CabinRequestSheet` / `EventComposer` are the
  reference consumers; `Lightbox` / `AvatarCropper` use just the hook
  (`MemberSheet` keeps its own drag-to-dismiss physics).
- **Loading states** — async pages show pulsing card placeholders
  ([`components/Skeleton.tsx`](components/Skeleton.tsx) `SkeletonList`), not a
  bare "Loading…" line.
- **Formatting** — dates/numbers/currency go through
  [`lib/format.ts`](lib/format.ts). Add new formatters there.
- **`@/*`** path alias maps to repo root (see `tsconfig.json`).
- **`npm install`** relies on `.npmrc` (`legacy-peer-deps=true`).
- **`npm run typecheck`** (`tsc --noEmit`) is the static check — there's no
  ESLint setup (`next lint` was removed in Next 16).
- Client components (`TabBar`, `InstallHint`) carry `"use client"`.
- **App version / update nudge** — each build stamps `NEXT_PUBLIC_BUILD_ID`
  (commit SHA on Vercel/Pages via `VERCEL_GIT_COMMIT_SHA`/`GITHUB_SHA`, a
  timestamp locally) into the bundle **and** writes `public/version.json` — both
  from one source in [`next.config.ts`](next.config.ts) so they can't disagree
  (`version.json` is gitignored — it's a build artifact). [`UpdateBanner`](components/UpdateBanner.tsx)
  (mounted in [`layout.tsx`](app/layout.tsx)) polls `version.json` (on focus +
  every 5 min, `no-store`) and shows a one-tap **Refresh** bar when it differs
  from the running id — so a Home-Screen PWA stuck on an old build gets nudged
  instead of going silently stale, without a manual close/reopen. Refresh clears
  Cache Storage then reloads (the shell is served `must-revalidate`; `sw.js`
  doesn't cache). `NEXT_PUBLIC_BASE_PATH` is exposed so the fetch resolves under
  the Pages subpath.

## Keep this current

When you add a route, dependency, env var, or change the data model, update
this file and `README.md` in the same commit. Doc drift is the only failure
mode that makes these files harmful.
