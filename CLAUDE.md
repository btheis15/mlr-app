# CLAUDE.md — mlr-app

Entry point for Claude/AI sessions on this repo. Read this first. For a single
machine-readable map of the whole app (routes, nav graph, ~55-table data model,
every component by domain, backend, chat internals, the motion kit, hard
constraints, and an improvement backlog), see
[`docs/ARCHITECTURE.json`](docs/ARCHITECTURE.json).

**Motion (updated):** `framer-motion` is now installed and is the physics layer
on top of the CSS motion tokens in `app/globals.css`. One global
[`MotionProvider`](components/MotionProvider.tsx) (`reducedMotion="user"`) wraps
the app in `layout.tsx`. Reusable primitives: [`AnimatedNumber`](components/AnimatedNumber.tsx)
(rAF count-up), [`AnimatedList`](components/AnimatedList.tsx) (FLIP reorder),
[`SegmentedControl`](components/SegmentedControl.tsx) + FamilyFestNav's `layoutId`
pill, [`Celebration`](components/Celebration.tsx) (confetti), and
[`TypingIndicator`](components/TypingIndicator.tsx). A wide-gamut **P3/HDR** color
layer (`@supports (color: color(display-p3 …))` in `globals.css`) enriches the
accent palette on capable screens; sRGB stays the source of truth. Haptics via
[`lib/haptics.ts`](lib/haptics.ts) (Android-only, no-op on iOS). Nav-gated states
that used to flicker in late are cached on-device: [`useCanEditFest`](lib/hooks.ts)
(fest Edit affordances) + the MJT dues card, plus [`useTypingChannel`](lib/hooks.ts)
for chat typing on its own realtime channel. Chat is optimistic (instant send,
spring-in bubbles, smart scroll + jump pill); a hold-then-fade cover
(`chat-unmask`) masks the room-open paint on mobile.

## What this repo is

A **Next.js 16 + React 19 + Tailwind v4 PWA** for **Muskellunge Lake Resort
(MLR)** — the year-round resort app. Mobile-first, vertical, **light mode only**,
built around the official **forest-green** MLR logo (white cabin-in-the-pines,
EST 1987) with vintage heritage from the original resort (Leo & Dorothy Theis ·
Fishing · Hunting · Boating · light-housekeeping cabins · Tomahawk, WI). Same
conventions as the author's other apps (`stock-game`, `innjoy-mobile`): App
Router, CSS-variable theme tokens, bottom `TabBar`, iOS install hint. Live on
**Vercel** (mlr-app-omega.vercel.app); **fully interactive** — sign-in (email
OTP), posts/chat, RSVP, polls, cabins, uploads, admin, and push are all live.
(`lib/features.ts` `READ_ONLY` is now **vestigial** — it gates nothing; features
check `isSupabaseConfigured` + per-migration existence instead.)

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

**Data model:** a mix by now — Supabase (Postgres + RLS + realtime) backs
identity, posts/chat, events/RSVP, committees, houses, polls, and more (see the
migrations below); a shrinking set of seed content (committee display roster,
resort events seed, Family Fest schedule/dinners fallback) still lives in
[`lib/data.ts`](lib/data.ts) as the pre-migration/offline fallback, never as the
only source once its table exists. Types in [`lib/types.ts`](lib/types.ts).
Some device-local bits (alert dismissals, demo-date override) still persist in
`localStorage`. Remaining gaps are scaffolded with a clean seam — see **Backend
seams**.

## The tabs

| Route | File | Status |
|---|---|---|
| `/` | [`app/page.tsx`](app/page.tsx) | Home — **kept lean**, in priority order: `WelcomeCard`/`HomeSignInCTA`, the Family Fest spotlight **call-out stack** ([`HomeSpotlight`](components/HomeSpotlight.tsx) → [`CalloutStack`](components/CalloutStack.tsx): the [`FamilyFestSpotlight`](components/FamilyFestSpotlight.tsx) is the permanent base, temporary call-outs stack on top as swipe-away cards — see **Home call-out stack**), nearest-event spotlight + RSVP ([`UpcomingEvents`](components/UpcomingEvents.tsx)), the collapsed-by-default [`WorkChecklist`](components/WorkChecklist.tsx), the always-visible **quick actions grid** ([`HomeQuickActions`](components/HomeQuickActions.tsx) — Events · Committees · People · Ask for Help · Local Places · Cabin Stay), self-hiding **garnish cards** ([`WeatherCard`](components/WeatherCard.tsx) · [`WhosUpNorthCard`](components/WhosUpNorthCard.tsx) · [`ActivePollCard`](components/ActivePollCard.tsx) · [`BirthdaysCard`](components/BirthdaysCard.tsx) — see **Home delight cards**), [`HouseHubCard`](components/HouseHubCard.tsx), the admin-only [`AdminDashboardCard`](components/AdminDashboardCard.tsx) (a fast `/admin` entry point right under it — see **Admin dashboard**), [`OnThisDayCard`](components/OnThisDayCard.tsx), an "App & help" group, one-line heritage |
| `/family-fest` | [`app/family-fest/`](app/family-fest/) | **Family Fest section** (its own `.ff-section` theme + [`FamilyFestNav`](components/FamilyFestNav.tsx) sticky sub-nav). Overview ([`page.tsx`](app/family-fest/page.tsx): poster + [`FestStatus`](components/FestStatus.tsx) + next-up + [`FestWeek`](components/FestWeek.tsx) accordion — the full week, including **anytime events** in an "Anytime all week" group (the old separate "activities" were merged into anytime `fest_schedule_items`, migration 0141)) · `dinners` (index page reads like a weekly menu — day, serving time, the menu, head chef, and houses on crew, one scrollable list, no tap-to-expand and no click-through; deliberately omits the crew-prep time/location, which only the crew needs — still editable, just not shown to every reader. Edit opens from an always-visible Edit button. The standalone `dinners/[id]` detail route still exists (kept for any direct/deep link, and still shows the full logistics) but nothing in the app links to it anymore) · `pay` ([`PayView`](components/PayView.tsx)). The nav hides on the editor surfaces (`/family-fest/planner`, `/family-fest/master`) |
| `/posts` | [`app/posts/page.tsx`](app/posts/page.tsx) | **Feed** tab — the resort-wide Posts feed plus a live chat for each committee/house you're in, switchable by pills, no overlay ([`FeedView`](components/FeedView.tsx) wrapping [`PostsView`](components/PostsView.tsx)/[`CommitteeChat`](components/CommitteeChat.tsx)/[`HouseChat`](components/HouseChat.tsx)). Members-only (`SignInWall`) |
| `/polls` | [`app/polls/page.tsx`](app/polls/page.tsx) | **Polls** — the family's voting booth ([`PollsView`](components/PollsView.tsx) + [`PollComposer`](components/PollComposer.tsx)); any signed-in member can ask a question, one changeable vote each. Members-only (`SignInWall`). Not a tab — reached from the Home [`ActivePollCard`](components/ActivePollCard.tsx) when a poll is open, or `/polls` directly. See **Family polls** |
| `/admin` | [`app/admin/page.tsx`](app/admin/page.tsx) | **Admin dashboard** — the front door for admin tools (9 cards + a Family Fest Planner link), gated by [`AdminGuard`](app/admin/AdminGuard.tsx). Not a tab — reached from Profile, or the [`AdminDashboardCard`](components/AdminDashboardCard.tsx) on Home. See **Admin dashboard** |

**Posts feed** ([`PostsView`](components/PostsView.tsx)) supports `@mentions` in
**comments** as well as the existing post tagging — the comment box has inline
`@name` autocomplete over the whole member list, mentions persist in
`post_comment_mentions` (migration [`0022`](supabase/migrations/0022_post_comment_mentions.sql),
public-read like comments), and `@name` renders highlighted (shared
`MentionText` helper, mirrors the chat).

**Comments can carry photos/videos** (migration
[`0162`](supabase/migrations/0162_post_comment_media.sql)) — `post_comment_media`
mirrors `post_media` (0004) exactly: one row per attachment ordered by
`position`, members-only read (the 0081 lockdown doctrine), write narrowed to
the comment's own author (delete also allows an admin). The composer's photo/
video picker reuses `useMediaPicker` + the same compress/upload pipeline
`EditPostPanel` uses (uploads ride the **default** `posts` category, which the
mini moderates INLINE — so any flagged verdict already exists in
`media_moderation` by the time the client inserts the row, and the DB trigger
holds the comment automatically with no client-side handling needed). A
comment can be photo-only (text OR at least one file, same rule as the post
composer). Rendered as a small wrapping row of thumbnails (`CommentMedia`,
reusing `MediaItem` — NOT the full-bleed `MediaGrid`/`MediaCarousel` a post
uses, which is too heavy for an inline comment), tapping a photo opens the
existing `Lightbox`. Moderation mirrors post/chat media: `hold_comment_on_flagged_media`
(attach-time) + a fourth branch added to `hold_content_on_media_verdict`
(0128 §5b, the retroactive hold for an async verdict) — both set the
`mlr.mod_bypass` GUC so the automated hold isn't reverted by
`moderate_content_text()`'s member-edit pin. `entity_type = 'comment'` already
routed to `post_comments` in `moderation_queue()`/`set_content_status()` (0128),
so neither needed a change.

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
| `/people` | [`app/people/page.tsx`](app/people/page.tsx) | **People** — the member directory ([`PeopleDirectory`](components/PeopleDirectory.tsx)): everyone with an account, searchable, each with a quick Text / Call / pay bar + tap-through to their full profile ([`MemberSheet`](components/MemberSheet.tsx)), plus **email a group** ([`EmailMembersSection`](components/EmailMembersSection.tsx) → [`EmailMembers`](components/EmailMembers.tsx)) — pick specific people, a committee you're in (once its members have assigned areas, e.g. Family Fest, the composer's "By Role" tab lets you narrow to just that role/subcommittee — roles now ride on `committee_member_recipients`, migration [`0124`](supabase/migrations/0124_email_roles_and_admins.sql)), your house, App Admins, or Everyone. Members-only (`SignInWall`). **Not a tab** — reached from the People tile in [`HomeQuickActions`](components/HomeQuickActions.tsx) |
| `/profile` | [`app/profile/page.tsx`](app/profile/page.tsx) | Identity, avatar, contact/pay settings, email-alert opt-in, in-app notification prefs ([`NotifPrefs`](components/NotifPrefs.tsx)), Ask-for-Help opt-in, text size, sign out. Now **flattened** — the old nine nested admin accordions moved to the standalone **`/admin` dashboard** (a single `RowLink` here for admins); Preview-As moved to `/admin/preview`. **The last bottom tab** — it moved back here from the header avatar, which was removed |
| `/local-places` | [`app/local-places/page.tsx`](app/local-places/page.tsx) | **Local Places** — nearby businesses with quick Menu/Order/Call/Website links ([`LocalPlaceCard`](components/LocalPlaceCard.tsx)), data in [`lib/places.ts`](lib/places.ts); linked from Home. Inshalla hands off to the in-app `/tee-times` screen |
| `/events` | [`app/events/page.tsx`](app/events/page.tsx) | **Events** — the resort calendar + RSVP. Every upcoming gathering with a Going / Maybe / Can't-make control ([`AttendanceControl`](components/AttendanceControl.tsx)), a tap-through to who's coming + a per-day drill-down for Family Fest ([`EventSheet`](components/EventSheet.tsx)); admins create/edit ([`EventComposer`](components/EventComposer.tsx)). Linked from Home; nearest event is also spotlighted on Home ([`UpcomingEvents`](components/UpcomingEvents.tsx)). See **Resort events & attendance** |
| `/help` | [`app/help/page.tsx`](app/help/page.tsx) | **Help & how-to** — non-technical onboarding: what the app is, browse-vs-sign-in, "I didn't get my code" troubleshooting, add-to-home-screen ([`InstallButton`](components/InstallButton.tsx)), a **text-size control** ([`TextSizeControl`](components/TextSizeControl.tsx)), and a **"Take a quick tour"** link to the guided-tour walkthrough ([`/guide`](app/guide/page.tsx) — an in-app viewer that embeds `public/mlr-app-guide.pdf`, the portrait presenter/onboarding deck, keeping the TabBar + a Back button so it's never a dead-end; also surfaced as its own card in Home's "App & help" group). Leads with a human escape hatch (text/email `HELP_CONTACT` in [`lib/help.ts`](lib/help.ts)). Linked from Profile + the sign-in sheet. Not a tab |

Bottom nav: [`components/TabBar.tsx`](components/TabBar.tsx) (the `TABS` array
is the single source of truth for routes + labels + icons): Home · Feed ·
Family Fest · Activity · **Profile**. Icons are the hand-rolled SVG set in
[`components/Icon.tsx`](components/Icon.tsx) — the bar no longer renders emoji
(a tent replaces the old crossed-swords Family Fest glyph; the live dot/badges/
fest color are unchanged). (Profile moved back to a tab from the old header
avatar; People moved off the bar to a Home tile.)

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
is **dynamic**: normally the quick-actions grid (`[data-fit-anchor]`,
[`HomeQuickActions`](components/HomeQuickActions.tsx)) — **but when Home has no
upcoming events** (the `[data-home-events]` block in
[`UpcomingEvents`](components/UpcomingEvents.tsx) renders nothing) it drops to
the "App & help" group at the bottom of Home
(`[data-fit-anchor-empty]`, in [`app/page.tsx`](app/page.tsx)) so the logo
**shrinks to show it** instead of ballooning to fill the freed space (the
garnish cards + House Hub in between self-hide for most viewers, so that group
is usually the next landing spot). It fits at load / on viewport change, **not**
on live reflow — so scrolling or a card self-hiding after mount doesn't
re-trigger it. Shrinks to the old `h-16` on short screens (SE).

App-open splash: [`components/SplashIntro.tsx`](components/SplashIntro.tsx) pops
the green logo center-screen, then **flies + zooms it into the header's
`#app-logo` slot** (a measured FLIP translate/scale). The header logo is held
hidden for the whole splash (`html[data-splash] #app-logo { opacity: 0 }` in
[`app/globals.css`](app/globals.css), kept laid out so it stays measurable) and
revealed the instant the fly lands — so the logo reads as *placed* into the
header, not cross-faded against a second copy. `splash-wash` is the CSS-only
self-clear fallback; reduce-motion skips straight to the app (attribute never
set, header logo shows normally). The splash is also the app's **first-paint
mask**: it holds until `authReady` (the sign-in check settled) **plus, on a
cold open, up to +700ms more** while any cold data loads land — fed by the
readiness registry in [`lib/appReady.ts`](lib/appReady.ts), which
`useCachedResource` (see **Loading stability & the SWR cache**) marks pending
whenever a fetch starts with nothing seeded from cache. On a warm open every
card seeds instantly, nothing registers, and the hold adds ~0ms; the 4.5s
`MAX_WAIT_MS` safety cap is unchanged and always wins.

## Non-technical / accessibility UX

Built for a family of mixed ages, so the rough edges that stop the least
technical members are smoothed:

- **Sign-in (`SignInGate` in [`IdentityProvider`](components/IdentityProvider.tsx))** — passwordless email-OTP with a **"check your spam"** hint, a **Resend code** button (30s cooldown so taps can't trip Supabase's rate limit), plain-language error mapping (`friendlyAuthError`), and a "Need help signing in?" link to `/help`. Code input is **digit-count-agnostic on purpose** — it accepts 6-8 digits rather than hard-coding a length, since Supabase's email OTP is 6 digits by default and this can't drift out of sync with however the project is actually configured (see `supabase/README.md` "Auth emails"). Every sign-in entry routes through `promptSignIn()`, so that's the one chokepoint for sign-in gating.
- **"Add it first, sign in once" nudge** ([`InstallFirstNudge`](components/InstallFirstNudge.tsx)) — on **iOS**, Safari and the installed Home-Screen PWA keep **separate** logins, so a guest who signs in *in the browser* then adds MLR later has to sign in a **second** time in the icon app. So `promptSignIn()` intercepts when `isIos() && !isStandalone()` and shows this interstitial first (prominent "Add to Home Screen" → `requestInstall()` opens the same `InstallHint` walkthrough — there's no one-tap install API on iOS; plus a "Sign in here anyway" that falls through to `SignInGate`). Gated to iOS because Android/desktop installed PWAs reuse the browser session — no double sign-in to warn about.
- **Install** — [`InstallHint`](components/InstallHint.tsx) is the single install authority: the iOS first-run nag **plus** on-demand install via `requestInstall()` ([`lib/install.ts`](lib/install.ts)). On Android/desktop Chrome it fires the captured native `beforeinstallprompt`; on iOS it opens the Safari walkthrough. [`InstallButton`](components/InstallButton.tsx) (Home, Profile, Help) is the re-entry point — it self-hides once installed.
- **Welcome** — [`WelcomeCard`](components/WelcomeCard.tsx) shows once per device on Home, orienting newcomers to browse-first + no-password sign-in.
- **First-run member onboarding** — [`WelcomeIntro`](components/WelcomeIntro.tsx) is a guided two-step sheet that pops the first time a **brand-new** member verifies their sign-in code, when their profile is still essentially empty (only the name they typed at signup). **Step 1** welcomes them and collects the basics inline — phone, birthday, preferred payment — so they never have to discover Settings; **step 2** explains push and drops them into the real [`PushToggle`](components/PushToggle.tsx) settings (master on by default → untick what they don't want), then lands them on Home. It's gated by `IdentityProvider` `needsIntro` (`profiles.intro_seen` false **and** the profile is sparse), computed in a **separate, guarded** query so a pre-migration column never breaks sign-in. It deliberately **supersedes the standalone [`PushPrompt`](components/PushPrompt.tsx)** (which now holds off while `needsIntro`, and reaching the push step stamps `push_prompted` so nobody is asked twice). Migration [`0045`](supabase/migrations/0045_member_intro.sql) adds `profiles.intro_seen` (new accounts default false; existing members backfilled true so the current family isn't re-onboarded).
- **Text size + zoom** — [`TextSizeControl`](components/TextSizeControl.tsx) overrides the `<html>` rem root (17/19/21px); a boot script in [`layout.tsx`](app/layout.tsx) re-applies the saved choice before paint. Pinch-zoom is now allowed (viewport `userScalable: true`, was disabled). `body` uses `font-size: 1rem` so the override scales the whole app — **don't re-pin a px font-size on `body`/`html`** or you break it.
- **Sign-in walls** ([`Guard`](components/Guard.tsx), `CommitteeJoin`, `CommitteeChat`) carry a "just your name & email, no password" reassurance.
- **Scrolling & bounce** — `#app-scroll` (the `<main>` in [`app/layout.tsx`](app/layout.tsx))
  is the app's one and only scroll container; `html`/`body` never scroll (see
  the note in [`app/globals.css`](app/globals.css)). This gives real native
  iOS rubber-band bounce at both edges without the classic WebKit bug where
  dragging past the DOCUMENT's top/bottom drags any `position: fixed` element
  (the TabBar) along with it — the TabBar sits fixed relative to the viewport
  as a sibling of `#app-scroll`, not a descendant, so it never moves regardless
  of how `#app-scroll` bounces. There's no pull-to-refresh gesture (removed —
  realtime subscriptions keep data current, and [`UpdateBanner`](components/UpdateBanner.tsx)
  already nudges a refresh when a new build ships); [`ScrollReset`](components/ScrollReset.tsx)
  (mounted in `app/template.tsx`, same per-navigation lifecycle the old
  PullToRefresh rode) resets `#app-scroll` to the top on every route change,
  since it — unlike `template.tsx`'s children — lives in the persistent
  `RootLayout` and doesn't remount on its own.

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

**Admin-managed taxonomy (migration [`0112`](supabase/migrations/0112_admin_committee_taxonomy.sql)).**
App admins **create / rename / "delete" committees and the roles inside them**
from **Admin → Committees** ([`AdminCommittees`](components/AdminCommittees.tsx)):
create a committee (`create_committee` auto-slugs it), edit its
name/emoji/description (`update_committee` — **the slug never changes**, since
`committee_roster`/`committee_areas` key off it), and add/rename/archive its
**roles** (= areas; each role is its own chat channel, 0063). The committee +
role lists are now **DB-driven everywhere** ([`lib/committeeAdmin.ts`](lib/committeeAdmin.ts)
`fetchCommittees`/`fetchCommitteeAreas`) — `committee_areas` is the single
source of truth for "what roles exist" (the old hardcoded `FAMILY_FEST_AREAS`
reads in `CommitteeRoster`/`CommitteeJoin`/`CommitteeMembers` are gone; the
seed lives on only as an offline/first-paint fallback). Renaming a role
(`rename_committee_area`) cascades the text through **all seven places** it's
denormalized (allow-list, `committee_roster.roles[]`, `committee_members.areas[]`,
`committee_messages.area`, `committee_area_reads.area`,
`committee_join_requests.requested_areas[]`, and `meetings.area` — the last added
in migration [`0121`](supabase/migrations/0121_rename_area_meetings.sql) so a
role-scoped meeting isn't orphaned) in one transaction, so the chat history +
memberships + scheduled meetings follow the new name.

**"Delete" is an archive, not a destroy.** Archiving a committee or role
(`archive_committee`/`archive_committee_area`) sets `archived_at`: it drops out
of the live lists and its chat goes **read-only** (an insert guard in RLS via
`is_committee_area_archived`; reads still work for who was in it), but the roster
is untouched so `restore_*` brings it fully back. Archived chats surface under a
quiet **"Archived chats"** disclosure at the foot of the Feed tab
([`FeedView`](components/FeedView.tsx) `ArchivedChatsLine` → `CommitteeChat readOnly`).
Committee **routes are prerendered + DB-aware**: `/committees/[slug]` +
`/committees/[slug]/chat` render client components
([`CommitteeDetail`](components/CommitteeDetail.tsx) /
[`CommitteeChatRoute`](components/CommitteeChatRoute.tsx)) and their
`generateStaticParams` unions the seed with live DB slugs at build
([`lib/committeeParams.ts`](lib/committeeParams.ts), `dynamicParams = true`), so
an admin-created committee gets a real page (and works live on Vercel
immediately; the chat is also always reachable from the Feed tab regardless).

**Two distinct rosters — don't confuse them.** (1) The **static display roster**
above (`COMMITTEES`, public, includes account-less people). (2) The Supabase
**`committee_members`** table — account-only membership that gates **chat**,
managed by leads/admins via [`CommitteeMembers`](components/CommitteeMembers.tsx)
and readable only by that committee's members (RLS, [`0012`](supabase/migrations/0012_committees.sql)).
They count different things, so an admin can see e.g. "[2] members" (DB chat
membership) alongside a different static roster — that's expected, not a bug.

**Joining Family Fest requires at least one area.** For a role-based
committee (`areaOptions.length > 0` — only Family Fest today), tapping
"Request to join" in `CommitteeJoin` always opens a blocking
`RoleRequiredSheet` — that sheet is the *only* place the area picker lives
(there's no separate inline picker on the card, and no way to send the
request without going through it) — the requester must pick at least one
area there before "Send request" is enabled. This is UI-only
(`request_to_join` itself still accepts an empty `requested_areas` array
server-side), so nobody lands "on the committee" with nothing assigned via
this surface, without adding a DB-level constraint that could break other
callers.

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
"pick a member"). The DB-backed roster (`committee_roster`, read via
[`lib/committeeRoster.ts`](lib/committeeRoster.ts) `fetchCommitteeRoster()`) is
where the emails/phones used for the link key and `mailto:`/`tel:` actually
live — **not** the static `COMMITTEES` seed in `lib/data.ts`, which carries
names/roles only (no `email`/`phone` fields at all — see **Committees & account
linking**'s intro). Since migration
[`0081`](supabase/migrations/0081_rls_lockdown.sql), `committee_roster` reads
are members-only (`auth.uid() is not null`), so those emails no longer ship to
an anonymous fetch either — display is gated behind sign-in at both layers now.

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
  and resolve the viewer's own house, or a `?house=<slug>`
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
  `useIdentity()` exposes `{ user, userId, isAdmin, authReady, updateUser,
  promptSignIn, signOut }` (`user` is `null` while browsing as a guest;
  `userId` is the REAL session uid — never the preview identity — available on
  the first client tick). Identity is a verified Supabase email-OTP session
  (persisted on-device by supabase-js); at sign-in the guest opts in/out of
  email alerts. An **on-device identity snapshot** (`mlr.cache.v1.identity.<uid>`,
  written after each profile load) restores `user`/`isAdmin` on
  the first client tick of a cold open — so a returning member never flashes
  the guest view (or the SignInWall) while the profile refetches. It's cleared
  by `signOut()` (via `clearAllCaches()`), never written during preview, and
  deliberately excludes the one-time intro flags. Trade-off: a since-demoted
  admin can paint admin UI for ~1s until the fresh profile lands — fine, since
  `is_admin` is UI-only and RLS is the real gate.
- **Admins** — strictly `profiles.is_admin` in Supabase; the database is the
  **single source of truth** (there is no client allow-list — it could only grant
  UI the server won't honor). The first admin is bootstrapped once from the SQL
  editor; after that admins promote each other in-app. Admins reach every admin
  tool from the **`/admin` dashboard** (see **Admin dashboard** below); the
  member directory ([`AdminMembers`](components/AdminMembers.tsx)) —
  promote/remove-admin *and* permanently remove a member — and **recent
  sign-ins** ([`AdminSignins`](components/AdminSignins.tsx)) live at
  `/admin/members` and `/admin/signins`. Clients can't write `is_admin`
  (column-level grant in `0001`, insert guard in `0010`); admin-gated SECURITY
  DEFINER functions back the rest: `admin_members()` + `set_admin()`
  ([`0008`](supabase/migrations/0008_admin_members.sql)), `delete_member()` (hard
  delete via `auth.users` cascade; can't delete yourself or an admin —
  [`0009`](supabase/migrations/0009_admin_remove_member.sql)), and
  `recent_signins()` (GoTrue audit log + IP, geolocated client-side —
  [`0011`](supabase/migrations/0011_admin_signin_log.sql)). Each section shows a
  "run the migration" hint until its function exists. Admins can also **view as**
  a member or guest ([`PreviewAs`](components/PreviewAs.tsx) at `/admin/preview`
  + floating [`PreviewBanner`](components/PreviewBanner.tsx)) — a device-local,
  UI-only `previewMode` override in `IdentityProvider` that re-renders the app as
  that role (to check the privacy wall); it never touches the real Supabase
  session.
- **Announcement banner** — [`components/AnnouncementBanner.tsx`](components/AnnouncementBanner.tsx)
  shows notices at the top of the app (server-fed seed +
  admin-posted alerts), dismissible per-device. Admin alerts also **auto-expire**
  so they don't sit at the top forever: the composer
  ([`AdminBroadcastComposer`](components/AdminBroadcastComposer.tsx)) picks a
  window (default **6h**, up to **30 days**) → stamped onto `Announcement.expiresAt` /
  `announcements.expires_at`, and the banner hides any notice past its expiry
  (people can still dismiss sooner with ✕; expired local alerts are pruned from
  `localStorage` on load). Migration
  [`0022`](supabase/migrations/0022_announcement_default_expiry.sql) gives the
  column a server-side 6h default; seed/legacy rows with no expiry never auto-hide.
  Since migration [`0126`](supabase/migrations/0126_unified_broadcast_composer.sql),
  the banner only renders rows with `show_banner = true` (the flag that lets a
  send email without ever painting the banner) — see **Reach everyone** below.
- **Privacy wall (guests vs members)** — the app is still browsable, but sensitive
  info is gated behind sign-in via [`components/Guard.tsx`](components/Guard.tsx) +
  [`lib/privacy.ts`](lib/privacy.ts): `SignInWall` (whole-screen gate — wraps
  **Posts** and **Pay**), `Protected` (inline gate for a phone/email/location —
  guests get a "🔒 Sign in" chip), and `PrivateName` (full name for members,
  **first name only** for guests). `useGuest()` returns `guest = isSupabaseConfigured && !user`,
  so with no backend the app stays fully open (we never lock everyone out of an
  app that can't sign in); during prerender `user` is null, so the static HTML
  ships the gated/guest view. Applied to: Posts (`/posts`), Polls (`/polls`), People (`/people`), Pay/dues,
  MemberSheet (contact+pay), schedule/dinner/committee detail pages (locations,
  chef/lead/member contacts), FestStatus/FestWeek (today's locations + contacts),
  CommitteeJoin — the first four are whole-screen `SignInWall`s, the rest use
  `Protected`/`PrivateName` inline. **The database now
  enforces this wall too** (migration
  [`0081`](supabase/migrations/0081_rls_lockdown.sql)): profiles, posts (+
  comments/media/tags/reactions/mentions/albums), committee_roster,
  event_attendance, work_items (incl. the MLR branch), and houses are
  members-only reads (`auth.uid() is not null`); events, cabins, announcements,
  committees, committee_areas, app_images, and the fest_content tables stay
  public (browse-first content, no PII). Guests get names/avatars from the
  `public_profiles` view (first name only, masked server-side); client fallbacks
  catch a missing view (42P01) pre-migration. Guest-visible surfaces degrade to
  sign-in nudges instead of false empties (EventCard/EventSheet/FestRsvp "Sign
  in to see who's coming", WorkChecklist "Sign in to see the resort to-do
  list"). PII is now also mostly out of the **client bundle**: the committee
  roster seed in `lib/data.ts` carries names/roles only (no `email`/`phone`),
  and `lib/help.ts`'s `HELP_CONTACT` no longer hard-codes a real name/phone/email
  (stripped along with ~18 relatives' contact details in the same pass — see
  **Help contact**/migration 0082). The one deliberate exception is
  `resort_config`'s help-contact fields, which stay **public-read by design** —
  they're the sign-in escape hatch itself, so they can't be gated behind the
  sign-in they exist to unblock (see the 0082 migration header).

## Admin dashboard

`/admin` ([`app/admin/page.tsx`](app/admin/page.tsx)) is the front door for
every admin tool — a two-column grid of up to 10 cards plus a Family Fest
Planner banner, replacing the ~9 stacked, nested accordions that used to live
in Profile → Admin. Each card links to its own `/admin/*` sub-page mounting
the same component that used to live in the accordion (unchanged data flow,
just less nesting). One card (Media server) is `ownerOnly` — filtered out of
the grid for every admin except `lib/owner.ts`'s `OWNER_EMAIL`, see **Mac-mini
media server**'s "Remote restart" — so most admins see 9:

| Card | Route | Component |
|---|---|---|
| Members | `/admin/members` | [`AdminMembers`](components/AdminMembers.tsx) + [`AdminProfileOverride`](components/AdminProfileOverride.tsx) |
| Alerts & Notifications | `/admin/alerts` | [`AdminBroadcastComposer`](components/AdminBroadcastComposer.tsx) (the merged "reach everyone" composer — see **Reach everyone**) + [`AdminCallouts`](components/AdminCallouts.tsx) (Home call-out cards — see **Home call-out stack**) |
| Notification Test | `/admin/notification-test` | [`NotificationTestView`](components/NotificationTestView.tsx) — see **Test a member's notifications** |
| Content review | `/admin/content-review` | [`AdminModeration`](components/AdminModeration.tsx) |
| Committees & join requests | `/admin/committees` | [`AdminCommittees`](components/AdminCommittees.tsx) (also mounts the per-committee join-request queue) |
| Houses | `/admin/houses` | [`AdminHouses`](components/AdminHouses.tsx) |
| Cabin requests | `/admin/cabins` | [`AdminCabinBookings`](components/AdminCabinBookings.tsx) |
| Help contact | `/admin/help-contact` | [`AdminHelpContact`](components/AdminHelpContact.tsx) — see **Help contact** |
| Sign-ins | `/admin/signins` | [`AdminSignins`](components/AdminSignins.tsx) |
| Media server (owner-only) | `/admin/system` | [`AdminMediaServer`](components/AdminMediaServer.tsx) — one-tap "pull latest + restart" for the mac mini, see **Mac-mini media server** |
| View as | `/admin/preview` | [`PreviewAs`](components/PreviewAs.tsx) |

Every sub-page wraps its content in [`AdminGuard`](app/admin/AdminGuard.tsx) —
a skeleton while identity is still resolving, an "Admins only" card + a way back
Home for non-admins, the real page otherwise — so the isAdmin check + copy live
in one place instead of being repeated nine times. The dashboard also links to
`/family-fest/planner` (schedule, dinners, dues, and the Home callout cards —
see **Home call-out stack**). Profile itself is now **flattened**: it keeps
identity/avatar/contact/notification-prefs/text-size, and just a single
`RowLink` to `/admin` for admins.

**A second, faster entry point on Home.** [`AdminDashboardCard`](components/AdminDashboardCard.tsx)
is a horizontal card — same treatment as [`HouseHubCard`](components/HouseHubCard.tsx)
(solid color, icon chip, chevron), in `bg-accent` instead of `bg-primary` so
the two don't blur together — sitting right under it on Home
([`app/page.tsx`](app/page.tsx)). Self-hides for non-admins (`isAdmin`, which
already reads false during an admin's own "View as" preview — no extra
preview check needed). Purely a shortcut to `/admin`; Profile's `RowLink`
still works exactly as before.

## Help contact

The Help page's human escape-hatch contact (name/phone/email) is no longer a
hard-coded string in the client bundle — it's a singleton row in Supabase
(`resort_config`, migration
[`0082`](supabase/migrations/0082_resort_config.sql)), fetched by
[`lib/resortConfig.ts`](lib/resortConfig.ts) `fetchResortConfig()` and edited
in-app via [`AdminHelpContact`](components/AdminHelpContact.tsx)
(`/admin/help-contact`). ⚠️ There is deliberately **no "resort info"** concept
anywhere in the app — MLR is an old family place, not an operating resort, so
the table's legacy address/phone/wifi/check-in columns are ignored (never read,
never edited; don't resurrect them). `RESORT_CONFIG_FALLBACK` mirrors the old
hard-coded contact and is used verbatim whenever the live value can't be
trusted (no Supabase configured, the 0082 migration hasn't run, or an
unexpected read error) — never throws. Read is **deliberately public**
(anon + authenticated): the help contact is the sign-in escape hatch itself, so
it can't be gated behind the very sign-in it exists to unblock.
Writes are admin-only (RLS against `profiles.is_admin`). `app/help/page.tsx` is
the one place that fetches + renders the live contact today — any new consumer
should call `fetchResortConfig()` too rather than reading real values from
`lib/help.ts`'s now-neutral `HELP_CONTACT` placeholder.

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
  phase **on the client** (returns `null` until mounted → no hydration mismatch).
  A build-time `new Date()` would freeze the phase at deploy.
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

## Dinner chef/crew self-edit + inline admin editing (migration 0099)

Writing to `fest_dinners`/`fest_schedule_items` normally requires
`can_edit_fest()` (admin or Family Fest committee membership), exercised only
through the full [`FestPlanner`](components/FestPlanner.tsx) at
`/family-fest/master`. Two things layer on top of that, both surfaced right
where the schedule/dinner already show up — [`FestWeek`](components/FestWeek.tsx)'s
`EventRow`/`DinnerRow` (the Overview/Schedule accordion, tap-to-expand), the
**Dinners tab** index ([`app/family-fest/dinners/page.tsx`](app/family-fest/dinners/page.tsx)'s
`DinnerCard` — reads like a weekly menu: day, serving time, the menu, head
chef, and houses on crew, shown at once with no tap-to-expand and no
separate detail page to visit. Deliberately omits the crew-prep time/
location (only the crew needs that logistics; still editable via the same
edit sheet, just not part of this reader-facing card)), [`FestStatus`](components/FestStatus.tsx)'s
`TodayEvent`/`TodayDinner` (the "Happening today" cards during the live week —
same edit affordance, just without the tap-to-expand step since those cards
are always fully shown), and [`FestDinnerDetail`](components/FestDinnerDetail.tsx)
(the standalone `dinners/[id]` page, no longer linked from anywhere in-app but
left in place) — instead of only inside the Planner:

- **Chef/crew self-edit.** A dinner's **head chef and any assigned crew
  members** don't need to be on the Family Fest committee to be the ones
  actually running that night, so they can edit that one dinner's
  **operational details** (menu, served time/location, prep time/location —
  deliberately *not* day/title/chef/crew/houses, which stay admin/
  committee-managed) via the shared
  [`DinnerDetailsEditSheet`](components/DinnerDetailsEditSheet.tsx), which
  writes through a narrower `updateDinnerDetails()` (a plain partial update —
  not `writeRow`/`saveDinner`, which always write every `DinnerInput` field
  and would clobber fields this surface never touches).
  - **Data model:** `fest_dinners.chef_user_id` was already a real FK to
    `profiles` (day one, migration 0053) — no new column needed for the chef
    side. `crew_user_ids uuid[]` is new (mirrors the existing `houses text[]`
    column shape rather than a join table, since it's just a small assignment
    list). A second, narrower `for update` RLS policy (`chef_user_id =
    auth.uid() or auth.uid() = any(crew_user_ids)`) layers on top of the
    existing blanket `can_edit_fest()` write policy — Postgres ORs multiple
    permissive policies for the same command, so this composes without
    touching that one. It's **update-only**, not `for all`: a chef/crew
    member can edit an existing dinner, not insert or delete one.
  - **Assigning crew** is admin/committee-only, in the Planner's
    `DinnerSheet` — a "Crew members" multi-picker (`CrewPickerSheet`, a
    toggle-multiple sibling of the existing single-pick `MemberPickerSheet`
    used for the head chef) alongside the existing "Houses on crew" free-text
    field (still house names, not individual members — houses says which
    families are teaming up, crew members says who specifically gets edit
    rights).
- **Full admin/committee editing, in place.** A viewer with full
  `can_edit_fest()` access gets an Edit affordance on **every** row/card here,
  not just dinners — `EventRow`/`DinnerRow`, `TodayEvent`/`TodayDinner`, and
  `FestDinnerDetail` all reuse the Planner's own `ScheduleSheet`/`DinnerSheet`
  (both now `export`ed from `FestPlanner.tsx` for exactly this) rather than a
  duplicate, narrower form — so an admin can change a dinner's chef, crew,
  houses, day, and title (or an event's time, location, lead, everything)
  right from the accordion/"Happening today"/detail view, with no trip to
  `/family-fest/master` needed. This needs the full `DinnerDraft`/`ScheduleDraft`
  (carrying `position`, which the display `Dinner`/`ScheduleEvent` types don't)
  plus the member directory, so `FestWeek`/`FestStatus`/`FestDinnerDetail` each
  fetch `fetchDinnerDrafts()`/`fetchScheduleDrafts()`/`fetchMemberOptions()`
  themselves, but **only once `canEditFest()` resolves true** — a chef/crew
  self-editor or a regular member never pays for that extra round-trip. A
  chef/crew (non-admin) self-editor still gets only the narrower
  `DinnerDetailsEditSheet`. **`FestWeek`'s day-by-day accordion always lists
  every day, including today** — it used to omit today while the fest is
  live (on the theory that `FestStatus` already covers it up top), but that
  meant losing today's entry from the list entirely, plus its edit affordance
  had no equivalent up top until `FestStatus` gained its own here.

**Extended to schedule events + anytime activities (migration 0110).** The
same chef/crew shape now applies to `fest_schedule_items` (which already had
a `lead_user_id`/`lead_name`/`lead_phone` FK from day one, migration 0053,
but no crew — day/title/private stay admin/committee-managed, same as
dinner's day/title/houses) and to `fest_activities` ("Anytime all week" on
the Overview page — which had **no** lead/crew concept at all before this,
so `lead_user_id`/`lead_name`/`lead_phone`/`crew_user_ids` were all added
fresh). Same narrower self-edit RLS policy shape
(`lead_user_id = auth.uid() or auth.uid() = any(crew_user_ids)`), same
narrower detail-only update functions (`updateScheduleDetails()` — location/
description/bring; `updateActivityDetails()` — blurb/details/location), same
narrower edit sheets ([`ScheduleDetailsEditSheet`](components/ScheduleDetailsEditSheet.tsx),
[`ActivityDetailsEditSheet`](components/ActivityDetailsEditSheet.tsx)), and
the Planner's `ScheduleSheet`/`ActivitySheet` both grew a "Crew members"
`CrewPickerSheet` picker (identical to `DinnerSheet`'s); `ActivitySheet` also
grew a `LeadPicker` (activities had never had one). `FestWeek`'s `EventRow`/
`ActivityCard` and `FestStatus`'s `TodayEvent` all now compute
`canEditThis = canEditAll || lead/crew match` the same way `DinnerRow`/
`TodayDinner` do, so a self-editor without full `can_edit_fest()` access gets
the narrower sheet while a full editor still gets the Planner's own full
sheet in place. Not extended: the standalone `schedule/[id]` detail page
(`FestDinnerDetail` has full edit; the schedule equivalent has none at all,
pre-existing gap, not touched here).

**Denormalized lead/chef names stay in sync with the profile (migration
[`0113`](supabase/migrations/0113_sync_fest_lead_names.sql)).** Each fest row
stores a display-name *snapshot* next to the real link —
`fest_schedule_items.lead_name` / `fest_activities.lead_name` (← `lead_user_id`)
and `fest_dinners.chef_name` (← `chef_user_id`) — stamped from the person's
`display_name` when they're assigned, and it's that stored copy the public cards
render (`FestWeek` "IN CHARGE", `FestStatus`, dinner detail). So a member who
renamed *after* being assigned (e.g. a new member assigned while their name was
still the email prefix `motu42`, then set to `Mikey 😀`) kept showing the old
snapshot on the card even though "Edit event" resolved the live profile via
`*_user_id`. An `after update of display_name` trigger on `profiles`
(`sync_fest_lead_names`) now rewrites the stored name on every fest row that
person leads/cooks — matched by `*_user_id`, never the free-text name, so an
account-less lead is untouched — plus a one-time backfill for names that already
drifted. Fixes web + iOS at once (both read the same columns); no client change.

## Event sign-up slots (migrations 0135 → 0136, activities 0138)

A schedule event **or an "Anytime all week" activity** can take **limited
sign-ups** for time slots (e.g. a craft station that fits 4 at a time, or a play
where each role is a seat). Turned on in the item's editor
([`ScheduleSheet`](components/FestPlanner.tsx) / `ActivitySheet`, both via the
shared `SignupConfigEditor`) by "the creator" = `can_edit_fest()` **OR** the
item's own lead/crew (the 0110 self-edit predicate, wrapped as
`_can_manage_schedule_signups` / `_can_manage_activity_signups`). Surfaced by the
shared [`ScheduleSignupSlots`](components/ScheduleSignupSlots.tsx) (a `kind` prop
picks schedule- vs activity-backed tables/RPCs) wherever the item's details
already render ([`FestWeek`](components/FestWeek.tsx)'s `EventRow` **and
`ActivityCard`**, [`FestStatus`](components/FestStatus.tsx)'s `TodayEvent`, the
schedule detail page). Client seam [`lib/scheduleSignups.ts`](lib/scheduleSignups.ts).

- **Schedule events and activities are parallel, isolated implementations**
  (migration 0138 mirrors 0135/0136 for `fest_activities`): the config columns
  live on each parent (`fest_schedule_items` / `fest_activities`), and each has
  its own slots + signups child tables (`fest_{schedule,activity}_slots` /
  `_signups`) and its own RPCs (`sign_up_for_{schedule,activity}_slot`,
  `remove_{schedule,activity}_signup`). Real FKs, cascade deletes, no
  nullable-parent gymnastics. Activities have no day of their own, so
  interval-mode slots there are time-only; slots-mode slots carry an optional day.

- **Two ways to define the slots** (`fest_schedule_items.signup_mode`):
  - **`interval`** (migration 0135, the original) — a capacity + interval +
    first/last time on the event's single day. The slot list isn't stored; it's
    **derived** identically client-side (`computeSlots`) and server-side
    (`fest_schedule_slot_starts()`) so they can't disagree.
  - **`slots`** (migration 0136 — "you don't have to have an event range") —
    an arbitrary list of **independent** slots, each with its **own day + start**,
    an optional end, an optional label, and an optional per-slot capacity. No two
    need to share a length or increment ("Mon 10:50am, Wed 1:48pm, …"). Stored as
    `fest_schedule_slots` rows (public-read; writes RLS-gated to the same manage
    predicate via `_can_manage_item_signups(item_id)`). The Planner's inline
    `SignupSlotsEditor` adds/removes them. Times use a `TimeSelect` (hour · minute
    · AM/PM `<select>`s — an iOS wheel, a real pick-list on Android/desktop)
    rather than a native `<input type=time>`, which on Android/desktop left the
    value empty until AM/PM was chosen (so "Add this slot" stayed disabled); the
    slot start is pre-filled to noon. When editing an **existing** item it
    writes live; on a **brand-new** item (no id yet) it stages slots in the sheet
    and `flushPendingSlots()` creates them right after the first save (so you can
    build the slots while creating the event — `writeRow` now returns the new id).
- **Instructions + custom columns** (migration 0136). The creator can write
  free-text `signup_instructions` and define `signup_fields` — an ordered jsonb
  array of `{id,label}` extra columns **required on every person's row** (e.g. a
  play wants "Name" + "Character"). Per-person values live in
  `fest_schedule_signups.fields` (jsonb keyed by field id); the RPC enforces
  every defined field is non-empty.
- **One person per row; anyone can add anyone.** Each seat is a row —
  a **linked member** (name snapshotted from the profile) **or a typed name** for
  someone without an account. Migration 0136 **drops the organizer gate**: any
  signed-in member may fill out a row for anyone (and several), via
  `sign_up_for_schedule_slot(p_item, p_slot, p_for_user, p_name, p_slot_id,
  p_fields)`. Capacity + one-linked-member-per-slot are enforced server-side.
  Removal (`remove_schedule_signup`) is limited to the row's **adder**, the
  **linked person**, or an **organizer**.
- **Roster view for the organizer/crew.** `canManage` viewers get a "📋 View all"
  button on the sign-up card opening `SignupRosterSheet` — every slot, person, and
  custom-column value as one scannable table (in `ScheduleSignupSlots`).
- **Anytime schedule events** (migration 0139). The event editor has an
  **"Anytime (no set day)"** toggle (`fest_schedule_items.anytime`) so an event
  isn't locked to a day — it renders in the "Anytime all week" group instead of a
  day card. Modeled as a flag, not a nullable `day`, so date formatters
  stay safe; `FestWeek`/`FestStatus` exclude `anytime` events from day/"today"
  lists, and the schedule detail header shows "Anytime all week".
- **"Anytime activities" are now just anytime events (migration 0141).** The old
  separate `fest_activities` concept is **retired on the web**: existing rows
  (scavenger hunt, merch, …) were converted into anytime `fest_schedule_items`
  (carrying their sign-up config/slots/signups; provenance in
  `source_activity_id` etc., idempotent). The Planner's **"Anytime activities"
  editor + `FestWeek`'s `ActivityCard` are gone** — you create everything through
  the event editor (with the anytime toggle), and the merged items are linkable
  from Home callouts like any event. ⚠️ **iOS still reads `fest_activities`** for
  its own Anytime section, so the table + rows are **left in place** (not dropped)
  — the native app is a follow-up (web-now/iOS-later); until then the two can
  drift (a web edit to a converted event won't reflect on the untouched activity
  row). `fetchFestContent` still returns `activities` but nothing web renders it.
- **Per-slot reminder pushes** (migration 0140). The creator picks one or more
  lead times (`fest_schedule_items.signup_reminder_minutes` /
  `fest_activities.signup_reminder_minutes` — quick chips 15m/30m/1h/2h/3h/1d + a
  custom-minutes input in `SignupConfigEditor`), and everyone signed up for a slot
  gets a `signup_reminder` notification (in-app + phone push) that long before
  **their** slot starts. Fired by a `pg_cron` tick `run_signup_reminders()` (like
  `run_scheduled_broadcasts`, works with the app closed), which resolves each
  slot's absolute instant (day + "HH:MM" at `America/Chicago`) and dedupes via the
  `fest_signup_reminders_sent` ledger. Only fires for slots with a real date/time
  (a schedule event's day, or any slot with a day) — activity-interval / day-less
  slots have no moment to count down to and are skipped. The recipient is the
  linked member, or — for a free-text **write-in** row (no account) — whoever
  **added** it (`coalesce(user_id, added_by)`), so a coordinator who signed a
  guest up still gets the nudge (worded "{guest}'s slot starts …"). When 2+ people
  share the slot the body also lists the whole group by name ("In this slot:
  Alice, Bob, …") — names only, linked or write-in, no custom-field data. The push is an
  `signup_reminder` is a `NotifType`, on by default, mutable in Profile →
  Notifications → Family Fest.
- **Manual "notify this slot" send (migration 0158).** The 0140 reminders above
  are pre-configured/automatic only — there was no way for a coordinator to just
  say "this slot's time is close, tell everyone" on demand. [`ScheduleSignupSlots`](components/ScheduleSignupSlots.tsx)
  now shows a **"🔔 Notify this slot"** button (visible to the same `canManage`
  viewers as "📋 View all", once at least one person is signed up for that
  slot) that opens quick lead-time chips (15 min/30 min/1 hour/2 hours/Now) and
  fires immediately — no waiting on the cron, no pre-configuration needed. It
  reuses the exact same `signup_reminder` notification kind as 0140 (so no new
  in-app-prefs wiring), sent via the
  `send_signup_slot_reminder_now(kind, item, slot_id, slot_start, minutes, email)`
  RPC (client seam `sendSlotReminderNow()` in [`lib/scheduleSignups.ts`](lib/scheduleSignups.ts)),
  gated on the same creator predicate (`_can_manage_item_signups`/
  `_can_manage_activity_item_signups`). This send still doesn't touch the 0140
  dedup ledger, so it can't collide with or double the automatic cron
  reminders.
  - ⚠️ **Fixed: the notification text used to be the sender's chosen chip
    label verbatim ("starts in 30 minutes"), with zero connection to the
    slot's real stored day/time (migration
    [`0165`](supabase/migrations/0165_signup_notify_real_time.sql).** A
    coordinator clicking the wrong chip (or the wrong slot's button) could
    send "starts in 30 minutes" for a slot that was actually a full day away
    — the recipient had no way to tell the lead time was wrong from the
    message alone. `send_signup_slot_reminder_now` now resolves the SAME real
    instant `run_signup_reminders()` computes (day + start_time, Central,
    DST-safe via `AT TIME ZONE 'America/Chicago'`) and states it plainly
    ("starts Thu, Jul 30 at 3:00 PM") instead of trusting the sender's
    minutes label. The old descriptive phrasing survives only as a fallback
    for a slot with no resolvable real time (an activity's interval slot has
    no calendar day at all).
- **`signup_reminder` is a normal, default-on push category — not a hidden
  override (migration 0159).** It used to buzz anyone with push on regardless
  of category picks (like `help_urgent`); it's now a real
  [`PushToggle`](components/PushToggle.tsx) row — **"Activity reminders"** —
  that's simply **on by default**: new members get it via `DEFAULT_PUSH_TYPES`
  ([`lib/types.ts`](lib/types.ts)), and everyone who already had push on at
  all before this migration was backfilled to have it too (mirrors 0037's
  `help_request`/`help_response` backfill). It's still opt-out-able — a member
  can untick it without turning off push entirely — which the pure override
  couldn't do.
- **Optional email alongside the push/in-app reminder (migration 0159).** Both
  the automatic cron (a per-event **"Also email everyone signed up"** checkbox
  in `SignupConfigEditor`, stored as `fest_schedule_items`/`fest_activities`
  `.signup_reminder_email`, off by default) and the manual send above (a
  same-named checkbox in the notify panel) can additionally queue a group
  email. Neither sends inline — both insert a deduped row into
  `fest_reminder_emails` (one per (item, slot, lead-time), unique-indexed so
  the cron's per-recipient loop and an accidental double-click each collapse
  to one row), which the mini's [`alert-mailer.js`](media-server/alert-mailer.js)
  claims and BCCs via the service-role `signup_reminder_email_recipients(row)`
  RPC (only linked members with a resolvable email — write-in/typed-name
  rows have no account to email). Like meeting/cabin-message emails, this is
  transactional and overrides `email_alerts` — the organizer opted the item
  in and the member signed up, so there's no separate preference to check.
- **A Home callout can link to an event's sign-up** (migration 0137).
  `home_callouts.signup_item_id` (a `fest_schedule_items` id, text — same shape
  as `event_id`) makes [`CalloutCard`](components/CalloutCard.tsx) render a
  prominent **"📝 Sign up"** button that deep-links to
  `/family-fest/schedule/<id>`, where [`FestScheduleDetail`](components/FestScheduleDetail.tsx)
  now renders the event's [`ScheduleSignupSlots`](components/ScheduleSignupSlots.tsx).
  Picked from a dropdown of signup-enabled events in
  [`AdminCallouts`](components/AdminCallouts.tsx)' `CalloutSheet`. **Distinct from
  the callout's `event_id`** (migration 0096, targeting only — hide from
  non-attendees): a callout can be linked to Family Fest 2026 for targeting AND
  carry a Sign up button to a specific schedule item at the same time.
- **Headcount mode + teams (migration 0143, schedule events only — not
  mirrored to `fest_activities`).** A third `signup_mode = 'headcount'` has no
  time dimension at all — just a running count against `signup_capacity`
  (nullable in this mode ⇒ no cap, just track who's coming; interval/slots
  still require a real number). It reuses `fest_schedule_signups` with both
  `slot_start` and `slot_id` null — the item's one "no slot" bucket, resolved
  client-side by `resolveSlotViews()` as a single `SlotView` with an empty
  `label` (the card's own "Sign up" heading covers it) and server-side by a
  third branch in `sign_up_for_schedule_slot()`. Separately,
  `fest_schedule_items.signup_team_size` (null/1 = individual) lets the
  creator require signing up in a **fixed-size team** — e.g. 2 for baggo
  doubles — in **any** mode, not just headcount: one sign-up action resolves
  every member (linked or typed, same as today) and inserts all of their rows
  together, sharing a generated `team_id` + optional `team_name`
  (`fest_schedule_signups.team_id`/`.team_name`). Capacity math is
  **unchanged** — still a plain people-count, so a team of 2 just consumes 2
  seats; the RPC's single capacity check covers the whole team atomically (no
  race where two teams grab the last few spots). `ScheduleSignupSlots`' `SlotCard`
  groups signups by `team_id` for display (a "🤝 {team name}" sub-heading over
  its members) and swaps the individual add form for `TeamSignupForm` (one
  name/link picker per member) whenever `signupTeamSize > 1`; the roster sheet
  gets a "Team" column under the same condition. `SignupConfigEditor` only
  offers the headcount mode option and the team-size field when
  `kind === "schedule"` — activities keep exactly the interval/slots choice
  they've always had (`activitySignupPayload()` is a type-safety backstop that
  can never actually receive "headcount" at runtime, since the UI never offers
  it there). Also fixed in this migration: `fest_schedule_signups.slot_start`
  was still `not null` from 0135, but 0136's insert can leave it `NULL` for a
  `slots`-mode row — so "Specific times" sign-ups had been failing outright
  since 0136 shipped; column is now nullable.
- 📱 **No iOS parity yet** — web-only so far; the schema/RPCs are shared, so the
  native app can add the same UI against these tables without a backend change.

## Tournament brackets (migration 0144)

A competitive **activity** (cornhole, ping-pong, horseshoes) can run a
**tournament** on top of its sign-ups. It attaches to a `fest_schedule_items` row
(a uuid FK — a **real DB activity only**, never an in-code seed slug) and draws its
entrants from that item's `fest_schedule_signups` (individual OR fixed-size teams,
0143). Any signed-in member watches the live bracket; the activity's **lead/crew**
(the `_can_manage_item_signups` predicate — same gate as its sign-ups) seed,
arrange, and score it. **No new organizer role** — `is_tournament_manager(t)`
resolves the item and defers to that existing predicate.

- **Data model** (all members-read, writes via `SECURITY DEFINER` RPCs, realtime):
  `tournaments` (one per activity: format `single_elim|round_robin|pools_bracket`,
  `entrant_type`, `team_size`, `bye_strategy`, `status setup|live|complete`,
  `tiebreakers[]`, optional `target_score`/`win_by`, `winner_entrant_id`),
  `tournament_entrants` (a solo player or a team; `seed`, `display_name`, `pool`,
  `signup_team_id` back-link), `tournament_participants` (the people —
  **`entrant_id` null = the pre-team pool**; **`user_id` null = an account-less
  typed name**, the 0143 linked-or-typed idiom, `on delete set null` keeps the name
  snapshot), and `tournament_matches` (the bracket graph — `round`/`position`, two
  slot entrants, scores, winner, a `next_match_id`+`next_slot` progression pointer,
  `is_play_in`, `stage pool|bracket` + `pool` for the later formats).
- **Single-elimination is the shipped format (Phase A).** `generate_bracket`
  fold-seeds (standard 1-vs-N, mirrors the pure `seedOrder` in `lib/tournaments.ts`),
  sizes to the next power of two, and auto-resolves **byes** (a round-1 match with one
  null slot, completed at generation). `bye_strategy`: **byes** (top seeds rest — falls
  out of fold-seeding) or **play_in** (same graph, round-1 real games flagged/labeled
  play-in) — random seeding naturally scatters byes ("random byes").
- **Round-robin (Phase B, migration 0145)** — `generate_round_robin` schedules every
  pair once via the circle method (odd count → a phantom bye that round). Standings are
  computed **client-side** (`computeStandings` in `lib/tournaments.ts`) by the ordered
  `tiebreakers` (win% → head-to-head → point diff → points-for), rendered by
  [`TournamentStandings`](components/TournamentStandings.tsx); PF/PA/Diff columns only
  appear once a score is entered (scores stay optional). `record_match_result` is
  **format-aware** (0145): a round-robin game just records (no propagation), and once
  every game is complete the standings leader is crowned. Managers also get a
  **⇄ Rearrange** mode on a single-elim bracket (tap a team, tap a spot to move/swap).
- **Pools → bracket (Phase C, migration 0146)** — `generate_pools` snakes entrants
  into `pool_count` pools by seed, each a round-robin (`stage='pool'`, `pool='A'…`).
  Once every pool game is complete, `generate_bracket_from_pools` takes the top
  `advance_per_pool` of each pool and seeds a single-elim knockout via the shared
  `_tournament_build_bracket` helper, **cross-seeded** (global seed =
  `(pool_rank-1)*pool_count + pool_index + 1`) so pool winners meet only late.
  Pool games record without propagating (the format-aware `record_match_result`);
  the knockout crowns the champion like single_elim. UI: a **Pools / Games / Bracket**
  tab set, with a manager "Generate knockout bracket" button once pools finish.
- **Scoring is one tap: pick the winner; scores are OPTIONAL** (`record_match_result(
  p_match, p_winner, p_score1 default null, p_score2 default null)` — winner alone is a
  complete result). It propagates the winner into `next_match`; changing a decided
  result runs the recursive `_tournament_advance` cascade that **clears every stale
  downstream result** so they're replayed. `set_match_entrant`/`swap_match_entrants`
  hand-place seeds; `reset_bracket` re-opens for restructuring. A
  `pg_advisory_xact_lock(tournament_id)` serializes concurrent manager edits.
- **Entrants:** `import_entrants_from_signups` (teams → grouped by
  `fest_schedule_signups.team_id`; individuals → the pool), `generate_teams`
  (random-pair the pool into teams of `team_size`), plus `add_participant`/
  `add_entrant` for hand-adds — **including account-less typed names** (fully
  supported; they just can't receive notifications).
- **Client:** seam [`lib/tournaments.ts`](lib/tournaments.ts) (types, the pure bracket
  math `bracketSize`/`seedOrder`/`firstRoundPreview`/`bracketSummary` for the setup
  preview, fetch + RPC wrappers, `applyMatchResult` optimistic transform; degrades to
  "no tournament" on 42P01). Hook `useTournament(scheduleItemId)` in
  [`lib/hooks.ts`](lib/hooks.ts) (uid-scoped SWR `tournament.<uid>.<itemId>`, realtime
  over all four tables, optimistic `recordResult` with a per-match in-flight lock).
- **Gated by a per-activity flag (migration 0147):** `fest_schedule_items.tournament_enabled`
  (public-read, mirrors `signup_enabled`) — set by a **"🏆 Tournament" toggle in the activity
  editor** (`ScheduleSheet` in FestPlanner). `TournamentSection` renders **only** when the flag
  is on, so the section never shows on non-tournament activities (guests included). Wired through
  `lib/festContent.ts` (`ScheduleRow`/`mapSchedule`/`ScheduleInput`/`saveScheduleItem` + the
  schedule selects) and `ScheduleEvent.tournamentEnabled`.
- **Surfaces:** [`TournamentView`](components/TournamentView.tsx) (`TournamentSection`
  is the mount) renders on [`FestScheduleDetail`](components/FestScheduleDetail.tsx)
  and inline in [`FestWeek`](components/FestWeek.tsx)'s `EventRow` (**mounted only when
  the row is open** — Expander keeps children in the DOM, so a per-row realtime channel
  would otherwise open for every event). A spectator "Now/Bracket" toggle
  ([`TournamentBracket`](components/TournamentBracket.tsx) round pager,
  [`MatchResultSheet`](components/MatchResultSheet.tsx),
  [`TournamentSetupSheet`](components/TournamentSetupSheet.tsx)). A Home call-out with
  `signup_item_id` already deep-links to the activity, so advertising a tournament is free.
- **Notifications:** `tournament_published` / `tournament_match_ready` /
  `tournament_champion` via `_notify` (Family Fest section of `NotifPrefs`, default on;
  `PushToggle` opt-in; both mini senders' `PUSHABLE_FEED_TYPES`). Account-less entrants
  get none (no `user_id`).
- 📱 **No iOS parity yet** — web-only; shared schema/RPCs.

## Private activities (migration 0150)

A **member-created, invite-only** one-off get-together that lives in the **Events**
tab (`/events`) but is visible ONLY to the people it's shared with — never
broadcast, no notification unless the organizer opts in, and then only to the
people involved. The use case: someone wants to run a quick **ping-pong / baggo
tournament** with a few family members over a random weekend, without making a big
resort "event", without an announcement, and without everyone seeing it. They tap
**"🎉 Create an activity"**, optionally flip on "🏆 Make it a tournament", and add
a handful of people (app members or **typed-in names** for anyone not on the app).

- **Who can create:** ANY signed-in member (the polls / work-items member-createable
  doctrine — NOT the admin-only `events` model). Guests get `promptSignIn()`.
- **Privacy = the houses/cabin-approver pattern.** A `SECURITY DEFINER`
  `is_private_activity_member(activity)` predicate (creator OR on the roster OR
  admin) is the RLS `using(...)` clause on both tables, so only the invited people
  can read the activity, its roster, and its tournament. `is_private_activity_host`
  (creator/admin/role='host') gates every mutation. There is deliberately **no
  all-members/public visibility** — private means private.
- **Data model:** `private_activities` (title/emoji/description/location, optional
  `starts_at`, `tournament_enabled`, `archived_at`, `created_by`) +
  `private_activity_members` (the roster: `user_id` null = a typed-in name, the
  0143 linked-or-typed idiom; `role host|player`; optional `rsvp going|maybe|out`).
  All writes via SECURITY DEFINER RPCs (`create_private_activity` bundles the
  invite list + an optional `p_notify`; `update_/delete_/set_private_activity_archived`,
  `add_/remove_private_activity_member`, `set_private_activity_member_role`,
  `set_private_activity_rsvp`). Realtime on both tables. **Stored in Supabase, not
  the mini** — that's what gets the privacy RLS, realtime, and tournament reuse for
  free (the mini is only media/push/email/moderation).
- **Tournaments are reused wholesale.** `tournaments` became **polymorphic**: it
  hangs off EITHER `schedule_item_id` (a fest activity) OR the new
  `private_activity_id` (exactly one, a `num_nonnulls(...) = 1` check).
  `is_tournament_manager` branches on which; the four tournament read policies were
  tightened so a private-activity tournament is visible only to that activity's
  members. Client-side, a `TournamentHost = {kind:'schedule'|'activity', id}`
  threads through `lib/tournaments.ts` (`fetchTournamentsForHost` /
  `createTournamentForHost` / `importEntrantsForHost`), `useTournament(host)`,
  `TournamentSection`, and `TournamentSetupSheet` — the same bracket/round-robin/
  pools/scoring UI, entrants imported from the roster instead of sign-ups
  (`import_entrants_from_activity_members`).
- **Notifications — only ever the people involved.** One kind,
  `private_activity_invite` (in-app on by default, phone push opt-in via `PushToggle`
  + both mini senders' pushable sets), fired ONLY when the organizer ticks "🔔 Let
  them know" on create (or adding a member with notify). The tournament's own
  `tournament_published/match_ready/champion` pings are already participant-scoped,
  so they stay private too; their deep-link now resolves via `_tournament_deep_link`
  to `/events?activity=<id>` for a private activity.
- **Archive + delete.** A host can **🗄️ Archive** a finished game (tucks it under a
  collapsed "Finished & archived" disclosure in the Events list, still deletable) or
  **Delete** it outright (cascades to roster + tournament).
- **One tournament per activity (migration 0151).** A partial unique index
  (`tournaments_one_per_activity` on `private_activity_id`) + an **idempotent**
  `create_activity_tournament` (returns the existing tournament if one exists) so a
  repeated "Create tournament" tap can never stack duplicates — it always lands on
  the one tournament.
- **Client:** seam [`lib/privateActivities.ts`](lib/privateActivities.ts) (degrades
  to none on 42P01), hook `usePrivateActivities()` in [`lib/hooks.ts`](lib/hooks.ts)
  (uid-scoped SWR `privateActivities.<uid>` + realtime), UI
  [`PrivateActivityComposer`](components/PrivateActivityComposer.tsx) +
  [`PrivateActivitySheet`](components/PrivateActivitySheet.tsx), listed + created on
  [`app/events/page.tsx`](app/events/page.tsx) (deep-link `?activity=<id>`).
- 📱 **No iOS parity yet** — web-only; shared schema/RPCs.

## Home call-out stack

The Home "what's happening" slot is a **Robinhood-style swipe-away card stack**
so temporary call-outs (future news/alerts) don't push the
page down — keeping the content below (nearest-event spotlight, Work
Checklist, the quick-actions grid) always in view without extra scrolling.
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
- **Call-outs are admin-managed rows**, not code: the `home_callouts` table
  (migration [`0083`](supabase/migrations/0083_home_callouts.sql) — public-read,
  writes gated to `can_edit_fest()`, realtime) is edited from **Admin → Alerts
  & Notifications** ([`AdminCallouts`](components/AdminCallouts.tsx) — moved
  out of the Family Fest Planner since a call-out isn't necessarily
  fest-specific, e.g. a work-weekend flyer): title/body, optional site-assets
  image, **one or more** `tel:`/`mailto:`/`https` action links (migration
  [`0093`](supabase/migrations/0093_callout_multi_link.sql) — `links` jsonb
  array, replacing the old single `link_href`/`link_label` pair; each renders
  on its own line in [`CalloutCard`](components/CalloutCard.tsx) so two links
  read as distinctly separate actions), a show window, position, active
  toggle, and the versioned `dismiss_id`, with a live `CalloutCard` preview.
  `HomeSpotlight` maps the active, in-window rows (via
  `useFestContent`; `useDemoDate().today` drives the window) into swipeable
  `StackItem`s keyed by each row's `dismiss_id`. Pre-migration/offline,
  `fetchFestContent()` degrades to `FALLBACK_CALLOUTS` in
  [`lib/festContent.ts`](lib/festContent.ts) (the seeded t-shirt flyer, identical
  to the 0083 seed row) — but **only on a missing-table error**: an empty table
  legitimately means "no call-outs". The `home_callouts` realtime subscription
  sits on its **own channel** in [`lib/useFestContent.ts`](lib/useFestContent.ts)
  so a pre-0083 database can't fail the fest tables' shared channel join.
- **"I did this — don't show again"** (migration
  [`0098`](supabase/migrations/0098_callout_completions.sql)) is a second,
  **permanent** dismissal, distinct from the swipe/✕ (which is
  session-scoped and comes back next time the app opens): a small button
  rendered by `CalloutCard` when `HomeSpotlight` passes an `onMarkDone`
  handler (omitted in the admin editor's live preview, so it never shows
  there). Tapping it writes an own-row in `home_callout_completions`
  (client seam [`lib/calloutCompletions.ts`](lib/calloutCompletions.ts), plain
  RLS-gated table — no RPC needed) and the card is optimistically filtered out
  of `HomeSpotlight`'s `items` immediately, keyed on the callout's stable `id`,
  not the mutable `dismiss_id`. Guests get the sign-in sheet instead (nothing
  to attach a completion to).

### Reach everyone: the merged broadcast composer (migration 0126)

Admin → Alerts & Notifications used to have two separate forms — "Post an
alert" (a banner, + optional email) and "Send a notification" (an Activity-tab
entry, + an optional banner mirror) — that collected almost the same
title/body/event-target/schedule fields twice. **[`AdminBroadcastComposer`](components/AdminBroadcastComposer.tsx)**
replaces both with one form and three independent channel checkboxes:

- **📣 Banner** — the top-of-app notice, unchanged (auto-expires on the
  window below; already pushes to phones for anyone with alert pushes on —
  that's automatic per the recipient's own `push_types`, not a separate
  admin-facing toggle here).
- **🔔 Activity tab** — the unchanged `send_broadcast_notification` RPC:
  Everyone or Admins-only, an optional tap-through link, its own badge-expiry.
- **✉️ Email** — opted-in members, or admins only.

Banner and Email both still write the same `announcements` row (Email alone
needs one too, since the mailer only watches that table) — what's new is
`announcements.show_banner` (default `true`), which lets a send **email
without ever painting the banner**. `AnnouncementBanner` only renders rows
where `show_banner = true`; `push-sender.js`'s `handleAlert` skips the phone
push for the same reason (push rides with the banner, not with email alone).
At least one channel must be checked. **Scheduling** (below) queues one
`scheduled_broadcasts` row per channel-group needed (an `'announcement'` row
for Banner and/or Email, a `'notification'` row for Activity tab) at the same
send time, rather than inventing a combined kind.

The two underlying primitives — insert-an-announcement and
call-send_broadcast_notification — live in
[`lib/broadcast.ts`](lib/broadcast.ts) (`postAnnouncement()` /
`sendActivityNotification()`), so a second surface can trigger the exact same
sends without duplicating the insert/RPC logic. **A Home callout is that
second surface**: `AdminCallouts`' `CalloutSheet` has two one-time side-action
toggles, reviewed right there before saving instead of a separate trip to
Alerts & Notifications — **"🔔 Also send a notification"** (a short input that
*is* the notification's title — deliberately no separate body field, since the
whole point is "a smaller text") and **"✉️ Also email everyone who opted in"**
(a textarea that defaults to the callout's own body/description until edited,
same auto-suggest idiom as the dismiss-id field). Both default **off** every
time the sheet opens — they're not a property of the saved callout, so editing
an existing callout later never silently resends. Firing happens right after
`saveCallout()` succeeds, using the callout's own `eventTarget` for the same
exclude-not-attending targeting the main composer offers; a failure there
surfaces as an error (blocking the sheet from closing) without undoing the
already-saved callout, so the admin can just retry.

### Test a member's notifications (migrations 0156-0157)

Its own Admin dashboard card — **Notification Test** (`/admin/notification-test`,
[`NotificationTestView`](components/NotificationTestView.tsx)) — with two related
tools any app admin can use, no more nested inside Alerts & Notifications:

- **Send a test to one member.** Pick ONE specific member (reusing FestPlanner's
  [`MemberPickerSheet`](components/FestPlanner.tsx)/`fetchMemberOptions()` search
  rather than a duplicate list) and fire a single test notification at them —
  for "I'm not getting notifications" support requests, so an admin can check
  the pipeline for that one person without alerting anyone else. Nothing sends
  until the admin explicitly picks someone and taps send.
  - **Data model:** `send_test_notification(p_user, p_title, p_body)` (migration
    0156, admin-gated SECURITY DEFINER) inserts one `notifications` row of type
    **`admin_test`** (client seam `sendTestNotification()` in
    [`lib/notificationTest.ts`](lib/notificationTest.ts)). It bypasses
    `profiles.notif_types` entirely, same as `broadcast` (0030) — the admin
    explicitly targeted this one person, so there's no preference to check.
    `admin_test` is a `NotifType` ([`lib/types.ts`](lib/types.ts)) with its own
    icon (🧪) in `NotificationsView`'s `TYPE_EMOJI` map, but **deliberately
    absent from `NotifPrefs`** (which is a hand-authored row list, not derived
    from the union) — same as `broadcast`, there's nothing to opt into.
  - **The phone push is an OVERRIDE**, exactly like `help_urgent`/`signup_reminder`
    in both mini senders (`push-sender.js`/`apns-sender.js`'s `PUSHABLE_FEED_TYPES`/
    `PUSHABLE` sets): anyone with phone push on (`push_types` non-empty) gets
    buzzed regardless of their per-category picks. The point is testing whether
    the push pipeline reaches that person's device at all, not respecting a
    category preference — if push is fully off, they correctly get nothing,
    which is itself useful diagnostic signal.
- **"Notifications confirmed" checklist (migration 0157).** Below the sender, a
  searchable list of every member with a checkbox: once an admin has actually
  watched a test notification land on someone's phone, they check the box next
  to that person's name — a lightweight, admin-visible record of who's been
  verified. It's deliberately **not wired to the send tool above** (an admin can
  check it off after a phone call just as well) and **not gated to whoever sent
  the original ping** — any app admin can check/uncheck anyone.
  - **Data model:** three plain columns on `profiles` —
    `notifications_confirmed boolean`, `notifications_confirmed_at timestamptz`,
    `notifications_confirmed_by uuid references profiles(id)` — flipped only by
    `set_notification_test_confirmed(p_user, p_value)` (admin-gated SECURITY
    DEFINER; stamps/clears the timestamp + who-confirmed together). Like
    `is_admin`/`house_id`, these are deliberately **absent from any client
    update grant** (`profiles`' blanket 0001 `revoke update ... from
    authenticated` covers new columns by default), so the RPC is the only write
    path. `fetchNotificationTestRoster()` in
    [`lib/notificationTest.ts`](lib/notificationTest.ts) resolves the
    "confirmed by" name from the same roster fetch (no second query) and
    degrades to a plain, all-unconfirmed list pre-migration rather than
    throwing.

### Event-targeted broadcasts (migration 0096)

All three admin broadcast tools under Admin → Alerts & Notifications — Home
call-outs, and the merged banner/Activity-tab/email composer
([`AdminBroadcastComposer`](components/AdminBroadcastComposer.tsx), see
**Reach everyone** above) — share one **"link to an event"** control
([`EventTargetPicker`](components/EventTargetPicker.tsx)): pick an event, and
an "only show to people attending" checkbox defaults **on**. The rule (see
[`lib/eventTargeting.ts`](lib/eventTargeting.ts) `isHiddenForEventTarget()`) is
deliberately narrow — it hides the item **only** from someone who explicitly
RSVP'd "Can't make it" to that event; a no-response member (or Going/Maybe)
still sees it, since they might still come and seeing it could nudge them to
RSVP. `event_attendance.status` is always the rolled-up value (kept in sync by
the client even for day-RSVP events like Family Fest — see `EventSheet`'s
day-picker), so a plain `status = 'not_going'` check is equivalent to the
client's `effectiveStatus()`.

- **Call-outs and the banner are fully client-rendered**, so filtering happens
  in the browser: `HomeSpotlight`/`AnnouncementBanner` both call `useEvents()`
  for the viewer's own `mine` RSVP map and run it through
  `isHiddenForEventTarget()`. `home_callouts`/`announcements` just carry two
  new columns (`event_id`, `exclude_not_attending`).
- **Broadcast notifications persist one row per recipient at send time**, so
  the filtering has to happen server-side: `send_broadcast_notification` grew
  two trailing-default params (`p_event_id`, `p_exclude_not_attending`) and
  excludes any profile with a matching `event_attendance.status = 'not_going'`
  row from the insert.
- Every write path degrades gracefully pre-migration (retries without the new
  columns/params on a column/param-not-found error), matching the existing
  `email_audience` fallback pattern in `lib/broadcast.ts`'s `postAnnouncement()`.
- **The mac-mini email itself is event-targeted too (migration
  [`0127`](supabase/migrations/0127_event_targeted_email.sql))** — the gap left
  by 0096: banner visibility, the Home callout, and the Activity-tab insert
  all respected "not going", but `alert-mailer.js`'s `handle()` emailed
  opted-in members regardless, since `alert_recipients()` had no idea an
  announcement was linked to an event. `alert_recipients()` grew the same two
  trailing params (`p_event_id`, `p_exclude_not_attending`) `send_broadcast_notification`
  already has, and the mailer passes the announcement row's own columns
  through (falling back to the old call shape pre-migration, same pattern as
  everywhere else). The mac mini's **phone push** for an alert
  (`push-sender.js`/`apns-sender.js` `handleAlert`) had the exact same gap —
  both now separately query `event_attendance` for `not_going` rows on the
  linked event and skip those profiles before sending. All four channels a
  banner/email send can reach — banner, Activity tab, email, push — now agree
  on who counts as "not going."

### Scheduled broadcasts (migration 0097)

`AdminBroadcastComposer` carries a shared
**"Send now" / "Schedule for later"** toggle
([`ScheduleSendPicker`](components/ScheduleSendPicker.tsx)). Scheduling one
writes a row to `scheduled_broadcasts` (`kind: 'announcement' | 'notification'`,
a `payload` jsonb mirroring exactly what the composer already collects,
`scheduled_at`) via `schedule_broadcast()` — client seam
[`lib/scheduledBroadcasts.ts`](lib/scheduledBroadcasts.ts). The actual send
happens **entirely inside Postgres via `pg_cron`** (already enabled on this
project — not the mac mini, not a Vercel cron), so a scheduled item still
fires even if the mini is asleep/off or nobody has the app open:
`run_scheduled_broadcasts()` ticks every minute, fires anything due (one row
at a time, wrapped so a bad payload can't sink the rest of the queue),
re-derives `expires_at` **relative to when it actually posts** (not when it
was scheduled — "6 hours" means 6 hours from going live either way), and
mirrors the exact same audience/event-targeting rules as an immediate send
(`send_broadcast_notification`) — see **Event-targeted broadcasts** above,
which this reuses rather than duplicating.

Admin → Alerts & Notifications → **Scheduled**
([`AdminScheduledBroadcasts`](components/AdminScheduledBroadcasts.tsx)) is the
queue view: pending items with **Edit** (`update_scheduled_broadcast`, migration
0101 — title/body/send-time, refuses once the row has already fired/cancelled)
and **Cancel** (`cancel_scheduled_broadcast`, a no-op if it already fired). Kept
live via Realtime, same shape as `AdminCabinBookings`. Already-fired rows never
get purged server-side (a quiet audit trail) — `fetchScheduledBroadcasts()`
(`lib/scheduledBroadcasts.ts`) fetches them as a separate, capped `history`
slice (most-recent-first) rather than mixing them into the same
ascending-by-scheduled-time query as `pending` (which would otherwise
eventually fill its limit with old history before ever reaching a genuinely
upcoming item). The UI keeps them out of the way in a collapsed **"🕘
Previously sent"** disclosure below the pending list (a failure is recorded on
the row (`error`) and surfaces there once expanded) — same "tucked below,
expand to see" idiom as the Feed tab's "Archived chats" line.

### Event/callout reminders (migration 0101)

An admin can attach one or more **reminder notifications** to a specific event
or Home callout — e.g. "remind everyone 1 day before the Faire sign-up
deadline" or "2 hours before the work weekend starts" — via
[`ReminderScheduler`](components/ReminderScheduler.tsx), embedded in
`EventComposer` (when editing an existing event) and `AdminCallouts`' sheet
(when editing an existing callout). A reminder is nothing new under the
hood — it's just another row in `scheduled_broadcasts` (see **Scheduled
broadcasts** above), tagged with `sourceType`/`sourceId`/`sourceLabel` in
`payload` so `ReminderScheduler` can list "reminders for this item" and
`AdminScheduledBroadcasts` can show what a reminder is attached to. It reuses
the same `eventId`/`excludeNotAttending` targeting as the other broadcast
composers when the event/callout itself has (or is linked to) an event.

**A callout reminder can skip anyone who already marked that callout "done"**
(`home_callout_completions`, the permanent per-member "I did this" from
migration 0098, distinct from the session-only swipe dismiss) — a checkbox in
`ReminderScheduler`, **"Skip anyone who already marked this callout 'done'"**,
default **on**, stored as `payload.excludeCalloutDone` (editable later too, in
`AdminScheduledBroadcasts`' edit sheet). This is the one payload field
`run_scheduled_broadcasts()` reads directly rather than treating as an opaque
label — when `sourceType = 'callout'` and the flag is on (`coalesce(...,
true)`, so pre-toggle rows from migration 0102 keep behaving as before), it
excludes any recipient with a completion row for that callout id before
sending, same idea as `excludeNotAttending` for event targeting. Migrations
[`0102`](supabase/migrations/0102_reminder_exclude_callout_done.sql) (always-on)
→ [`0103`](supabase/migrations/0103_reminder_exclude_callout_done_toggle.sql)
(made it optional).

Only usable once the item has a real id — a brand-new, unsaved event/callout
has nothing to attach a queued row to yet, so `ReminderScheduler` is mounted
only when editing an existing one (save first, then add reminders).

Two anchors gained an optional time to compute "N hours/days before" from:
- **`events.start_time`** (time, optional) — a plain `start_date` has no
  time-of-day; setting this offers hour-based offsets (1/2 hours before), not
  just day-based ones (which otherwise default to firing at 9am).
- **`home_callouts.deadline_at`** (timestamptz, optional) — distinct from
  `starts_on`/`ends_on` (which only gate the show/hide window), this is the
  actual "due by" moment a reminder counts down to.

Without an anchor set, `ReminderScheduler` falls back to an exact custom
date/time picker instead of relative offsets.

## Home delight cards

Below the quick-actions grid, Home carries a run of light, **self-hiding
garnish cards** — each renders nothing when it has nothing to say (guest, no
data, table not migrated yet), so Home never grows an empty box:

- [`WeatherCard`](components/WeatherCard.tsx) — today's temp + forecast for the
  lake, from **Open-Meteo** (no API key), fixed lat/long for Tomahawk, WI,
  cached via the shared SWR cache (`mlr.cache.v1.weather`, localStorage,
  30-minute TTL).
- [`WhosUpNorthCard`](components/WhosUpNorthCard.tsx) — members-only strip of
  who's at the resort *today*, reusing Ask-for-Help's presence rule (going to
  an event within its ±2-day window, or an approved cabin stay covering today)
  via the shared [`lib/presence.ts`](lib/presence.ts) (extracted from
  `lib/helpRequests.ts`'s single-viewer `amIPresent` check, widened to "who,
  not just am I").
- [`ActivePollCard`](components/ActivePollCard.tsx) — the newest open poll's
  question + running vote count, linking to `/polls`. See **Family polls**.
- [`BirthdaysCard`](components/BirthdaysCard.tsx) — members with a birthday in
  the next 14 days.
- [`HouseHubCard`](components/HouseHubCard.tsx) — unchanged from before (see
  **Houses**), sits just after these.
- [`OnThisDayCard`](components/OnThisDayCard.tsx) — a photo memory from a prior
  year within ±3 days of today's month-day, pulled from Posts feed photos.
  Members only.

All of these are client components reading Supabase directly (no new backend
seam); none needs its own migration beyond the tables they already read
(events/attendance/cabins, polls 0084, profiles, posts).

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

## Ask for Help

A member who's **at the resort** posts a short request for a hand (moving logs,
setting up, a ride, supplies, or the rare 🚨 Urgent); members who opted into
**Willing to Help** *and* are also at the resort right now get an in-app
notification + phone push, can tap **On my way** (the only response), and see open
requests in a shared **log** ([`/help-requests`](app/help-requests/page.tsx) →
[`HelpRequestsView`](components/HelpRequestsView.tsx)). The requester says how many
people they need; once that many are on the way the request reads **✅ Covered** and
everyone eligible is told (so others don't bother). Open to every signed-in member
(the [`WillingToHelpToggle`](components/WillingToHelpToggle.tsx) opt-in lives in
Profile) — it was originally gated behind a `profiles.beta_tester` role, dropped
in migration [`0100`](supabase/migrations/0100_remove_beta_tester.sql) along with
the Beta Tester concept entirely.

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
  server resolves recipients via `_help_recipients` (willing + present + the
  `help_request` notif pref) and re-checks the **requester** is present. It *trusts*
  the client's event-window snapshot — recomputing server-side would mean moving
  seed-event dates into the DB. Possible hardening: persist seed event windows +
  re-derive in the RPC (see the 0037 header).
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
- **Admins bypass the requester presence gate** (migration [`0038`](supabase/migrations/0038_help_test_affordances.sql)) —
  they can post from anywhere to test/demo (recipient presence still applies, so
  use "Notify everyone willing" to reach people when off-season). The
  beta-tester-requester self-ping this migration originally added was removed
  along with the Beta Tester concept (migration 0100).
- **Urgent goes to EVERYONE** (migration [`0046`](supabase/migrations/0046_help_bring_items_and_urgent_broadcast.sql)).
  A request with `category = 'urgent'` is an emergency, so it bypasses the
  willing + present filter and alerts **every member app-wide** via a new
  `help_urgent` notification kind (default on, mutable in Profile → Notifications;
  `NotifPrefs`). `notif_on_help_request` branches: urgent fans `help_urgent` out to
  all profiles (gated only by their `help_urgent` pref); everything else still uses
  `_help_recipients` (willing + present). The "✅ covered" fan-out branches the same
  way. The mini's push-sender treats `help_urgent` as an **override push** — anyone
  whose phone push is on (non-empty `push_types`) gets buzzed regardless of their
  per-category picks (so it isn't gated on `push_types` membership like the other
  feed pushes).

## Family polls

A dead-simple voting tool for the questions the family actually argues about
(fest merch designs, meal choices, dates). Unlike events (admin-managed), **any
signed-in member can create a poll** — a question + 2-10 options; every member
gets exactly **one vote per poll** (the primary key on `poll_votes` enforces
it) and can change it any time while the poll is open. A poll closes when its
creator or an admin closes it, or when its optional `closes_on` date has passed
(open *through* that day).

- **Data model:** migration [`0084`](supabase/migrations/0084_polls.sql) —
  `polls` / `poll_options` / `poll_votes`, all **members-only reads**
  (`auth.uid() is not null` — the 0081 doctrine, not public: votes are member
  activity, no reason for a guest/scraper to see them). All writes go through
  SECURITY DEFINER RPCs: `create_poll(question, options[], closes_on)`,
  `cast_poll_vote(poll, option)`, `close_poll(poll)`, `delete_poll(poll)` —
  creator-or-admin gated where it matters, the same shape as events/attendance
  (0034/0035). Realtime-enabled.
- **Client:** [`lib/polls.ts`](lib/polls.ts) (`fetchPolls`, `createPoll`,
  `castVote`, `closePoll`, `deletePoll`) degrades to "no polls" on a missing
  table (42P01, pre-migration) or no Supabase config — never throws.
- **Surfaces:** [`/polls`](app/polls/page.tsx) →
  [`PollsView`](components/PollsView.tsx) (list + vote/results + close/delete
  for the creator or an admin) + [`PollComposer`](components/PollComposer.tsx)
  (question + options form). Home's [`ActivePollCard`](components/ActivePollCard.tsx)
  spotlights the newest open poll (see **Home delight cards**).

## Meeting scheduling (committee/house/family → Google Meet or a real Event)

A built-in Doodle/when2meet-style scheduler pinned to any **committee/house chat
room**, or — since migration 0122 — open to the **whole family** (see below), so
a group stops asking the group chat over and over. An **organizer** proposes
candidate time slots; every member marks **Yes / If-need-be / No** per slot; the
organizer sees live tallies + the best slot, picks the winning option, and either
captures a **Google Meet** link (posts a join-link message + notifies everyone)
or **creates a real Event** on the resort calendar from it (see **Family-wide
polls + creating an Event** below).

- **Who can propose:** app admins (any room) **and**, for a committee, a **Lead**
  of that committee/area (a `committee_roster` role ending in `· Lead`). Houses
  have no lead concept, so house meetings are **admin-only**. Enforced server-side
  by `can_organize_meeting(scope, committee_id, area, house_id)`; the UI asks the
  same RPC (`fetchCanOrganize`) so the button can't drift from the gate.
- **Data model:** migration [`0116`](supabase/migrations/0116_meetings.sql) —
  `meetings` (scope + committee_id/committee_slug/area **or** house_id, title,
  status `open|scheduled|cancelled`, chosen_slot_id, meet_url), `meeting_slots`
  (candidate times, like `poll_options`), and `meeting_availability`
  (**PK (slot_id, user_id)** — one Yes/If-need-be/No per member per slot, like
  `event_attendance`). All **members-only reads scoped to the room** via the
  existing `can_access_committee_area` (0063) / `is_house_member` (0064) gates; all
  writes through SECURITY DEFINER RPCs: `create_meeting` (fans out
  `meeting_proposed`), `set_my_availability(meeting, {slotId:status})` (bulk upsert
  of the caller's own rows), `finalize_meeting(meeting, slot, meet_url)`
  (organizer-or-admin — marks it scheduled, posts a chat message into the room,
  fans out `meeting_scheduled`), `cancel_meeting`, `delete_meeting`. Realtime on
  all three tables so tallies move live.
- **Client:** [`lib/meetings.ts`](lib/meetings.ts) mirrors `lib/polls.ts`
  (42P01/no-config degradation, never throws): `fetchMeetingsForRoom(scope)`
  computes per-slot buckets + best-slot client-side; `applyMyAvailability`
  optimistic transform; `createMeeting`/`setMyAvailability`/`finalizeMeeting`/
  `cancelMeeting`/`deleteMeeting`; `fetchCanOrganize`; and the **Google Meet**
  helpers `googleCalendarCreateUrl` + `looksLikeMeetLink`.
- **Two ways to create (a toggle in [`MeetingComposer`](components/MeetingComposer.tsx)).**
  **"Find a time"** = propose slots → vote (the default, above). **"Set a time
  now"** = one known time, no voting: `create_scheduled_meeting` (migration
  [`0119`](supabase/migrations/0119_create_scheduled_meeting.sql)) inserts the
  meeting + a single slot and immediately `perform`s `finalize_meeting`, so it
  lands `scheduled` with the exact same downstream behavior as picking a winning
  slot — posts the room message, fans out `meeting_scheduled`, and (with a Meet
  link) sends the confirmation email off the status→scheduled UPDATE. The
  composer's set-a-time mode has the same guided "Create Google Meet" button +
  paste field, or you can set the time and add the link later (via the response
  bar's "Add the Meet link"). No `meeting_proposed`/voting happens.
- **Google Meet is guided in-app, one paste (no OAuth).** Finalizing opens a
  step panel *inside the scheduler sheet*: a "Create Google Meet" button opens a
  **fully prefilled** Google Calendar event (chosen time/title/details already
  filled — the same "create externally, paste link back" convention as the admin
  "Create a Google Form" card, `app/admin/page.tsx`), the organizer taps "Add
  Google Meet" → Save, then pastes the link into a field right there. A "Set the
  meeting" with a blank link is allowed (lock the time now, add the link later).
- **Surfaces (two, split by frequency):** Scheduling a *new* meeting is rare but
  important, so it lives **out of the way in the room's ⋯ menu** — the
  `ChatMembersSheet` in [`FeedView`](components/FeedView.tsx) (the sheet that lists
  who's in the chat) grew a **"📅 Schedule a meeting"** button, shown only to
  organizers (`fetchCanOrganize` gate) and hosting
  [`MeetingComposer`](components/MeetingComposer.tsx). Houses previously had no ⋯
  header button — one was added for parity (`openHouseMembers`). *Creating needs no
  member ids* (just title + slots), so it lives fine in FeedView.
  [`MeetingSection`](components/MeetingSection.tsx) is now **only the active-meeting
  response bar**, pinned at the top of the chat body (via
  [`CommitteeChat`](components/CommitteeChat.tsx) live rooms only /
  [`HouseChat`](components/HouseChat.tsx), one line each) — it renders **nothing
  unless a meeting is live** (open, else upcoming scheduled), owns the room's
  meetings fetch + realtime + SWR cache `meetings.<uid>.<roomKey>` + the
  `?meeting=<id>` deep-link, and hosts
  [`MeetingSchedulerSheet`](components/MeetingSchedulerSheet.tsx) (availability +
  tallies + "who's free" + the guided finalize; needs the room roster's ids for
  name resolution, hence it stays in the chat body). A meeting created from the ⋯
  menu shows up in the bar on the next realtime tick — no cross-component wiring.
- **The same ⋯ menu also has an "✉️ Email members" button** — unlike scheduling,
  open to **anyone** viewing the room (no organizer gate: everyone here can
  already see everyone here). It hosts a `ChatEmailSheet` (also in `FeedView.tsx`)
  that reuses the People page's [`EmailMembersComposer`](components/EmailMembersComposer.tsx)
  (see **People** in the tabs table), pre-scoped instead of pool-picked: a
  committee's General channel emails `fetchCommitteeRecipients` for the whole
  roster (`lib/emailBlast.ts`); an area sub-channel (e.g. Family Fest's "Meals")
  client-filters that same roster down to the area's members, mirroring exactly
  who `openMembers()` lists in the roster sheet above it; a house channel calls
  `fetchHouseRecipients`. Composing/sending is unchanged — still a `mailto:`
  hand-off, nothing sent from the app.
- **Activity + push:** two notification kinds `meeting_proposed` (→ every room
  member: "mark when you're free") and `meeting_scheduled` (→ every room member:
  "meeting set", with the join link), fanned out by `_notify_meeting_room` over
  the same recipient predicate as the read gate. Default **on** in
  [`NotifPrefs`](components/NotifPrefs.tsx) (a "Meetings" section, not admin-gated).
  Both are in `PUSHABLE_FEED_TYPES` (push-sender.js + apns-sender.js) + a
  [`PushToggle`](components/PushToggle.tsx) row (off by default → opt in).
- **Two optional/automatic emails via the mac-mini
  [`alert-mailer.js`](media-server/alert-mailer.js)** — both the exact claim-a-row
  pattern as admin alerts. **PRINCIPLE: `profiles.email_alerts` gates ONLY the
  broadcast Alerts/Notifications email channel (`alert_recipients`, 0127). Every
  *transactional* email overrides it** — meeting proposal/confirmation and the cabin
  "message guests" note (migrations
  [`0132`](supabase/migrations/0132_meeting_email_all_members.sql) →
  [`0133`](supabase/migrations/0133_transactional_email_overrides.sql)); cabin
  approve/deny/edit/cancel already ignored it (they go to the single requester via
  `cabin_booking_notification`). So meeting emails reach **every room member with an
  email regardless of `email_alerts`** — verified members, invited-but-unverified
  "temp" accounts (`/admin/invite` creates `auth.users` + a `profiles` row via the
  `on_auth_user_created` trigger; the roster-link trigger stamps
  `committee_roster.linked_user_id` on email match), AND **account-less rostered
  people** (committee_roster / family_roster slots with an email but no account — the
  `UNION`s from 0123, which 0132 accidentally dropped and 0133 restored). Like all
  mini email/push, they need the mini running + restarted.
  - **Proposal email (opt-in, migration
    [`0117`](supabase/migrations/0117_meeting_proposal_email.sql)).** The composer
    has an **"Also email everyone a link to vote"** checkbox, **default OFF** — the
    organizer opts in per meeting. When set, `create_meeting`'s `p_email` stamps
    `meetings.notify_email`; the mailer's `handleMeeting` emails the room a
    heads-up with a button deep-linking into the voting UI (`notify_email` +
    `proposal_email_sent_at`, service-role `meeting_proposal_email(meeting)` RPC,
    excludes the organizer).
  - **Confirmation email (automatic, migration
    [`0118`](supabase/migrations/0118_meeting_confirmed_email.sql)).** When a
    meeting is finalized to a time **with a Meet link**, the mailer's
    `handleMeetingConfirmed` sends the whole group (INCLUDING the organizer) a
    polished email — what it's for, when (Central), and a big "Join the Google
    Meet" button. Always fires on confirmation (it's the payoff), claimed via
    `meetings.confirm_email_sent_at` and **gated on `meet_url`** so a linkless
    finalize waits until the link is added, then fires with it. Service-role
    `meeting_confirmed_email(meeting)` RPC. No change to `finalize_meeting` — the
    mailer watches a `meetings` UPDATE to `status='scheduled'`.
- 📱 **iOS parity is a planned follow-up** — the schema/RPCs are shared, so the
  native app can add the same scheduler against `meetings`/`meeting_slots`/
  `meeting_availability` without a backend change.

### Family-wide polls + creating an Event (migration 0122)

Two extensions on top of the above, for "which weekend can everyone make it for
the Work Weekend?" — a poll open to every signed-in member, whose winning slot
becomes a real row on the resort calendar rather than a Meet link.

- **A third scope, `'family'`** — `committee_id`/`house_id` both null. Reads are
  open to any signed-in member (RLS: `auth.uid() is not null`, same doctrine as
  the generic **Family polls**). Organizing one is **admin-only** — this falls
  straight out of `can_organize_meeting`'s existing "admin, unconditionally" check
  with zero code change to that function. Entry point:
  **Admin → `/events` → "📅 Propose dates"** (`app/events/page.tsx`, gated on
  `fetchCanOrganize({type:"family"})`) opens
  [`MeetingComposer`](components/MeetingComposer.tsx) with `scope={{type:"family"}}`;
  the active poll (any signed-in member can vote) is a card-surface
  [`MeetingSection`](components/MeetingSection.tsx) near the top of `/events`,
  mirroring how `CommitteeDetail` embeds one on a committee page.
- **Date-range slots.** `meeting_slots.ends_at` (nullable) — when set, a slot is
  a **date range** ("Fri Jul 25 – Sun Jul 27"), not a point-in-time call.
  `MeetingComposer` gets a **"Times" vs "Dates"** toggle (defaults to Dates for
  a family scope) that swaps each slot row's time picker for a second date
  picker. Existing call-style slots (`ends_at` null) are untouched.
- **A second finalize outcome: create an Event.** In
  [`MeetingSchedulerSheet`](components/MeetingSchedulerSheet.tsx), finalizing a
  slot now offers **"Schedule a call"** (the existing Meet-link flow, unchanged)
  or **"Create an event"** — title/kind/location, then
  `finalize_meeting_as_event(meeting, slot, kind, title, description, location)`
  inserts a row into `events` (`source = 'meeting'`, `source_meeting_id` back-link;
  `meetings.created_event_id` points the other way) and marks the meeting
  scheduled. Available regardless of scope — a committee/house meeting can
  finalize into an Event too, not just a family one.
- **RSVPs carry over — but UNCONFIRMED.** Every member who voted Yes/If-need-be
  on the winning slot gets an `event_attendance` row (`going`/`maybe`) with the
  new **`confirmed = false`** — carrying the poll vote over as a starting point,
  not a final answer. `set_event_attendance`'s upsert now stamps `confirmed = true`
  on any self-write, so **reconfirming is just tapping your existing Going/Maybe/
  Can't-make control again** — no new button to learn. `EventSheet`'s roster tags
  an unconfirmed name with a quiet "(hasn't confirmed)" — visible to whoever's
  planning, invisible clutter for everyone else.
- **The confirmation nudge reuses the existing reminder scheduler**, it isn't a
  separate system. `finalize_meeting_as_event` auto-queues one
  `scheduled_broadcasts` reminder 14 days before the event (skipped if that's
  already past) with a new payload flag, **`onlyUnconfirmed`** —
  `run_scheduled_broadcasts()` restricts (not excludes) that send to profiles
  with no attendance row or one with `confirmed = false` for the linked event.
  [`ReminderScheduler`](components/ReminderScheduler.tsx) exposes the same flag as
  an "Only remind people who haven't confirmed yet" checkbox (shown whenever it
  has an `eventId`), so an admin can retime, edit, or cancel the auto-queued one,
  or add their own, exactly like any other event reminder.

## Quick polls in chat (migration 0149)

An iMessage/Messenger-style poll any member can drop into a **committee or
house chat** (not the Main Feed, which isn't a chat room at all) — a
question, 2–10 options (single- or multi-select), an optional write-in
"Other", and a choice of **anonymous** (counts only) or **attributed**
(counts + little avatar icons of who picked what) results.

- **Entry point is "🗳️ Create a poll" in the room's ⋯ menu** — the
  `ChatMembersSheet` in [`FeedView`](components/FeedView.tsx), alongside
  "📅 Schedule a meeting" and "✉️ Email members", for the same reason meetings
  live there: it's a rare-but-important action, so it stays out of the composer.
  Open to **any room member** (the family-polls doctrine — no organizer gate,
  unlike scheduling). `FeedView` mounts [`ChatPollComposer`](components/ChatPollComposer.tsx)
  itself, reusing the room scope it already resolved for meetings (`MeetingScope`
  is a superset of `ChatPollScope` — just drop the `"family"` case), so nothing
  is drilled into the chat components; a poll created here appears inline in the
  timeline on the next realtime tick, exactly like a meeting shows up in its bar.
  The composer keeps **one clean `+` button** (attach) next to the textarea.
  The **standalone** `/committees/[slug]/chat` route has no ⋯ menu, so it keeps
  an in-composer 🗳️ button gated on `!embedded`.
  - ⚠️⚠️ **Incident: attaching a photo in chat was broken in the installed iOS
    PWA for as long as the `+` POPUP MENU existed. NEVER trigger a file input
    from inside a popup/menu/overlay — copy the Main Feed composer instead.**
    The `+` used to open a small `framer-motion` spring-in menu (Photo Library /
    Take Photo / Document / Poll), and the three file `<input>`s were
    `.click()`ed from inside it. In a **standalone iOS PWA** that never
    delivered the file: the native picker opened, you could select a photo and
    tap the checkmark, and **nothing arrived in the composer, with no error at
    all** — it read as "sending photos just doesn't work". Non-standalone Safari
    was fine, and so was the Main Feed's post composer
    ([`PostsView`](components/PostsView.tsx)), whose trigger button is plain and
    always-mounted.
    **Three attempts to keep the menu and fix it around the edges all failed
    on-device** (recorded so nobody retries them): (1) mounting the inputs
    unconditionally at the composer root, outside the menu, so nothing unmounted
    them mid-pick; (2) removing `setAttachMenuOpen(false)` from the tap so the
    menu only closed after the picker resolved (via `pickFiles` or the input's
    native `cancel`); (3) `sr-only` instead of `hidden`, on the theory a
    laid-out input receives the selection more reliably.
    **What was actually removed is the POPUP, not the `+`** — the glyph was
    never the problem, and it's still the button. Its `onClick` is now nothing
    but `fileRef.current?.click()`, with one plain
    `<input type="file" multiple className="hidden">` as its immediate sibling:
    no popup, no `framer-motion`, no `fixed inset-0` overlay, and nothing
    conditionally rendered anywhere in the path — i.e. `PostsView`'s shape
    exactly. The input is deliberately **unfiltered (no `accept`)**, so the one
    button covers all three of the menu's old file items: iOS's own action sheet
    offers "Photo Library / Take Photo or Video / Choose File", keeping camera
    and documents one tap away through the same native path the Main Feed relies
    on. `pendingFromFile` still classifies each pick as image/video/file by MIME,
    so nothing downstream changed. The one deliberate regression is losing the
    one-tap `capture="environment"` camera shortcut — iOS's "Take Photo or
    Video" in its own sheet replaces it.
    **Takeaway:** a file input and its trigger must both be plain,
    always-mounted siblings. If an action needs to live behind a menu or sheet,
    it must not be a file picker — move the *other* actions there instead (which
    is exactly where Poll went) and leave the picker as a direct button.
- **Data model:** `chat_polls` / `chat_poll_options` / `chat_poll_votes`,
  scoped and read-gated exactly like `meetings` (0116) —
  `can_access_committee_area()` (0063) / `is_house_member()` (0064). All
  writes go through `SECURITY DEFINER` RPCs: `create_chat_poll` (any room
  member — the family-polls doctrine, not the meeting-organizer one; refuses
  in an archived committee area), `set_chat_poll_votes` (full-replace of the
  caller's own votes in one call — handles single/multi/"Other" text),
  `close_chat_poll` / `delete_chat_poll` (creator or admin).
- **Anonymity is enforced in SQL, not trusted to the client.**
  `chat_poll_votes` gets **no select grant at all** — RLS is enabled with
  zero policies, so nobody (including the voter's own devtools) can read a
  raw vote row, the same "deny-all" doctrine as `content_embeddings` (0129).
  Live tallies instead come from denormalized `chat_poll_options.vote_count`
  / `chat_polls.respondent_count`, kept current by an insert/delete trigger —
  both safely readable + realtime-able. `fetch_chat_polls_for_room()` returns
  a room's polls with counts + the caller's OWN selections (safe — it's
  their own vote); `chat_poll_voters()` is the one place identity is ever
  revealed, and it returns nothing at all when `chat_polls.anonymous` is
  true — enforced server-side, called only when a poll's results sheet
  opens.
- **Renders INLINE in the message timeline, not a pinned bar.** A first cut
  pinned open polls in a top bar (mirroring `MeetingSection`) — too easy to
  miss, since it doesn't sit where anyone's actually looking. Instead,
  `CommitteeChat`/`HouseChat` merge `chat_polls` in with `messages` client-side
  into one `TimelineItem[]` (sorted by `ts`/`createdAt`, then run through the
  existing `groupByDay`), so a poll shows up exactly where it happened in the
  conversation, like a rich message — not attached to any one sender's
  bubble (it's a room-wide card, full width), interactive on the spot: tap an
  option to vote immediately, no sheet to open first.
- **Client:** [`lib/chatPolls.ts`](lib/chatPolls.ts) (mirrors
  `lib/meetings.ts`'s degrade-to-empty-on-missing-table idiom) exports
  **`useChatPolls(scope)`** — the realtime (`chat_polls` + `chat_poll_options`,
  not `chat_poll_votes`) + SWR-cached (`chatPolls.<uid>.<roomKey>`) hook both
  chat components call directly (mirrors how `useTypingChannel` is a shared
  hook, not a mounted component) — called unconditionally per the rules of
  hooks even before the room/committee id resolves; `scope` itself is null
  until then and the hook just no-ops. [`ChatPollComposer`](components/ChatPollComposer.tsx)
  is the creation sheet (mounted from the "+" menu, not `FeedView`'s
  `ChatMembersSheet`). [`ChatPollCard`](components/ChatPollCard.tsx) is the
  inline card itself — option rows reuse `PollsView.tsx`'s `PollCard`
  bar-fill visual, extended for multi-select and an inline "Other" text
  field, with a row of `Avatar`s per option (from `chat_poll_voters`, fetched
  once per card mount) when the poll isn't anonymous, plus Close/Delete for
  the creator or an admin right on the card.
- **Notifications:** one kind, `chat_poll_created` (mirrors
  `meeting_proposed`) — default on, off by default for phone push (opt in via
  `PushToggle`, same as meetings). No notification on vote/close, mirroring
  family polls.
- 📱 **No iOS parity yet** — web-only; shared schema/RPCs if the native app
  adds it later.

## Venmo QR codes on a member's contact card

`MemberSheet`'s Pay section can show a **QR code for a member's Venmo**, right
below their Venmo row — a collapsed **"Show QR code"** disclosure so it never
adds visual weight for the common case (tapping the button). It encodes the
**exact same** `venmo.com/<handle>?txn=pay` deep link the button already opens
(`lib/contact.ts` `payActions()` now also sets `qr` on the Venmo `Action`) — a
QR code is just a container for that URL/text, not a signed or
Venmo-issued token, so a self-generated code scanning to the same link behaves
identically to the one in Venmo's own app; the built-in Reed–Solomon error
correction (a property of the QR standard itself, not anything Venmo does) is
also why a slightly worn or imperfectly printed code still scans.
- **Generated on-device** via the `qrcode` npm package
  ([`components/PayQRCode.tsx`](components/PayQRCode.tsx),
  `QRCode.toDataURL()`) — no third-party QR API, so a handle/link is never
  sent off-device just to render a code.
- **Who it's paying is unambiguous** — the disclosure/card always renders
  directly under that person's own name + Venmo row (never a bare code with
  no context), labels it "Scan to pay **{name}** on Venmo", repeats the
  `@handle` below the image, and reminds the scanner that Venmo will show the
  name again before sending, to double-check it matches.

## Cabin stays

"Request a Cabin Stay" (`/request-stay`) — members request a room in one of
the resort's bookable **places to stay** (`cabins` — started as just Cabin 1 +
Red & White House, now an open-ended admin-managed roster, see **Places to
stay: kind + a per-place approver** below) for any date range, defaulting to
Family Fest week; admins (or that place's designated approver) approve/deny
from Admin → Cabin requests. Same shape as events/attendance: public-read
tables, all writes through SECURITY DEFINER RPCs. Data model: migration
[`0032`](supabase/migrations/0032_cabin_bookings.sql) (`cabins`,
`cabin_bookings`, `request_cabin_stay`/`review_cabin_stay`/`cancel_cabin_stay`/
`cabin_availability`). Client seam [`lib/cabins.ts`](lib/cabins.ts); surfaces
[`app/request-stay/page.tsx`](app/request-stay/page.tsx),
[`CabinRequestSheet`](components/CabinRequestSheet.tsx),
[`AdminCabinBookings`](components/AdminCabinBookings.tsx).

### Places to stay: kind + a per-place approver (migration 0114)

Admins can now **add new places** from Admin → Cabin requests → Places to
stay ([`AdminCabinDetails`](components/AdminCabinDetails.tsx), "＋ Add a
place") instead of the roster being fixed at the original two houses — e.g. a
family member's own house with spare bedrooms. Each place carries:

- **`kind`** (`'cabin' | 'house'`, default `'cabin'`) — a label only (a
  shared resort structure vs. someone's private house); no booking/capacity
  behavior differs by kind. Shown as a badge on the member-facing card
  (`CabinCard` in `app/request-stay/page.tsx`) when `kind = 'house'`.
- **Bedrooms + beds-per-bedroom** — unchanged, this is just the existing
  named-room model (`cabin_rooms`, migration 0092) an admin fills in via
  `CabinRoomsEditor`. "Extra beds outside bedrooms" (a fold-out couch,
  sleeping bags, etc.) reuses the existing informational `cabins.bed_count`
  (0089) rather than a new column — the label in `AdminCabinDetails` and the
  copy in `CabinRequestSheet` just switch to "extra beds" once the place has
  named bedrooms, since at that point `bed_count` no longer means "beds
  overall" (the room-based beds_total/beds_available from `cabin_availability`
  cover that).
- **`approver_user_id`** — null (the default) means "all app admins review
  this place's requests," unchanged from before. Set it to a specific member
  via the new `ApproverPicker`/`ApproverPickerSheet` in `AdminCabinDetails` to
  make **that one person** the reviewer instead — critically, they do **not**
  need to be an app admin (e.g. the owner of a private house that's bookable
  through the app but who otherwise has no admin access). A new
  `is_cabin_approver(cabin_id)` SQL helper (admin OR that specific person) is
  the widened gate on `review_cabin_stay`/`cancel_cabin_stay`/
  `admin_update_cabin_booking`/`set_booking_rooms` and on `cabin_bookings`'/
  `cabin_booking_rooms`' read RLS, so a non-admin approver can see and act on
  requests for their own place(s) only — nothing else in the app opens up for
  them. `notif_on_cabin_request` also notifies that approver (in addition to
  admins, if they aren't one already) so they actually learn a request came
  in; the mini's `push-sender.js` `handleCabinRequest` mirrors the same
  widened recipient list for the phone push.
- **Where a non-admin approver reviews requests** — `/admin/cabins` stays
  admin-only (unchanged `AdminGuard`), so a non-admin approver instead sees a
  self-hiding **"Requests to approve"** section right on `/request-stay`
  itself (`app/request-stay/page.tsx` mounts `AdminCabinBookings` for
  non-admins; the component now computes its own `canManage` — app admin OR
  approver of at least one place, via `fetchMyApproverCabinIds()` — instead of
  gating on `isAdmin` alone, and renders nothing for anyone else). An app
  admin still only sees the queue at Admin → Cabin requests (all places, not
  just ones they're the named approver for).
- `create_cabin()` (admin-only RPC, mirrors `create_committee`'s auto-slug
  pattern) is the one write path for adding a place — client seam
  `createCabin()` in `lib/cabins.ts`.
- **`request_cabin_stay()` overload cleanup (migration 0115).** Migrations
  0092 and 0108 had each independently grown a 7-arg version of this function
  (ending in `p_room_ids uuid[]` vs. `p_notify boolean`, respectively) —
  0108 only dropped the older 6-arg signature, not 0092's, so both 7-arg
  overloads silently coexisted. Since the client always sends `p_room_ids`
  and never `p_notify`, every call resolved to 0092's overload — meaning any
  `request_notify = false` intent had never actually taken effect (that
  overload's INSERT doesn't mention the column, so it always fell back to the
  column default of `true`). 0115 merges both feature sets into one canonical
  8-arg function and drops the two superseded 7-arg ones; no client change
  was needed since the existing call now just resolves unambiguously.

### Message the guests staying at a place (migration 0120)

Whoever runs a bookable place — its designated **approver**, or an app admin
(the same `is_cabin_approver(cabin)` gate from 0114) — can send a note to
**everyone currently or soon staying there** ("water's off this weekend", "gate
code changed"). Recipients are the **distinct members with an approved booking
whose stay hasn't ended** (`check_out >= today`). Surfaced as a **"📣 Message
guests"** button at the top of [`AdminCabinBookings`](components/AdminCabinBookings.tsx)
(so both admins at `/admin/cabins` and non-admin approvers on `/request-stay`
get it) → [`CabinMessageSheet`](components/CabinMessageSheet.tsx) (pick the place —
auto-selected if you run only one — subject + body + an optional "Also email
them"). Client seam `sendCabinMessage()` / `fetchManageableCabins()` in
[`lib/cabins.ts`](lib/cabins.ts).

- **Data model:** `cabin_messages` (log row: cabin, sender, subject, body,
  `notify_email` + claimed `email_sent_at`), members-only read for the place's
  approver. `send_cabin_message(cabin, subject, body, email)` RPC — approver/
  admin gated — inserts the row and fans out a new **`cabin_message`**
  notification kind (default on, deep-links `/request-stay`) to the guests via
  `_notify` (so it honors each member's pref + skips the sender), returning the
  recipient count. It's a `PushType` (in `DEFAULT_PUSH_TYPES` + `PushToggle` +
  both mini senders' `PUSHABLE_FEED_TYPES`) so it also rides a phone push.
- **Optional email:** the mailer's `handleCabinMessage` (claim-a-row like the
  rest) uses the service-role `cabin_message_recipients(message)` RPC (approved
  not-yet-ended guests with `email_alerts` on, minus the sender) and BCCs them.
  Needs the mini restarted, like all mini email/push.

- **Admin-editable cabin details** (migration
  [`0089`](supabase/migrations/0089_cabin_editable_details.sql)): name, room
  count, an overall `bed_count`, a free-form `notes` line shown to members
  (e.g. "water not hooked up yet"), and an `active` toggle to pull a cabin out
  of the bookable list without losing its booking history. Edited via
  [`AdminCabinDetails`](components/AdminCabinDetails.tsx) (Admin → Cabin
  requests → Cabins).
- **Admin books on behalf of a member** (migration
  [`0087`](supabase/migrations/0087_cabin_booking_for_member.sql)) — for family
  who don't use the app themselves. `request_cabin_stay` takes an optional
  admin-only `p_for_user`; the booking lands under that member's id with
  `booked_by` stamped to the admin, shown in the admin queue as "booked by
  {admin}". The `/request-stay` "Booking for" picker (admin-only) sets this,
  and the request auto-approves right after creation (`reviewStay`) instead of
  sitting in the pending queue for the same admin to approve a second time.
- **Named rooms/areas within a cabin** (migration
  [`0092`](supabase/migrations/0092_cabin_rooms.sql); room `description` added
  in [`0094`](supabase/migrations/0094_cabin_room_description.sql)) — a cabin
  can be broken into specific, pickable rooms (`cabin_rooms`: name, `beds`, a
  free-form `description` shown to members in the picker e.g. "small room, no
  closet", `active`) instead of a bare room count, e.g. Red & White House's
  "Upstairs South Room", "Upstairs East Room", "Upstairs Open Area",
  "Downstairs Near Bathroom", "Downstairs Near Stairs" (seeded closed). **A
  cabin with zero `cabin_rooms` rows keeps the original plain-room-count flow
  untouched** — this is additive, not a replacement. Once a cabin has rooms:
  - Booking requires picking specific room(s) — one room per bed needed — via
    the shared [`CabinRoomPicker`](components/CabinRoomPicker.tsx) (used in
    both `CabinRequestSheet` and the admin's edit sheet), backed
    by `cabin_room_availability(cabin, check_in, check_out)` and
    `cabin_booking_rooms` (which room(s) a booking reserves — a booking can
    reserve more than one).
  - `review_cabin_stay`'s capacity check branches: a booking with rooms
    attached is checked per-room against other approved bookings of the same
    room; one with none (legacy, or a cabin with no rooms) keeps the original
    cabin-wide `room_count` math.
  - `cabin_availability`'s "X of Y rooms left" derives Y/X from the active
    `cabin_rooms` count/per-room overlap instead of the manually-set
    `room_count` field, so the two can't drift out of sync once rooms exist.
  - **Toggling a room (or a whole cabin) closed only blocks NEW picks** —
    `cabin_room_availability`/`request_cabin_stay`/`set_booking_rooms` all gate
    on `active`, but none of them touch `cabin_booking_rooms` rows already tied
    to existing reservations, so a room/cabin can be closed to future bookings
    without disturbing anyone already booked into it.
  - **`set_booking_rooms(booking, room_ids)`** is a standalone admin-only RPC
    to (re)assign rooms on **any** existing booking, any time — not just at
    creation. This is how reservations made before rooms existed get their
    room assignments filled in by hand, via "Edit" on each row in
    [`AdminCabinBookings`](components/AdminCabinBookings.tsx) →
    [`EditBookingSheet`](components/EditBookingSheet.tsx). Room CRUD itself
    (add/rename/set beds/description/open-close/delete) is inline in
    [`AdminCabinDetails`](components/AdminCabinDetails.tsx)'s edit sheet.
  - **`admin_update_cabin_booking(booking, check_in, check_out, guests, notes)`**
    (migration [`0095`](supabase/migrations/0095_admin_edit_booking.sql)) is the
    matching admin-only RPC for the request's other fields — dates, guest
    count, and notes — for corrections after the fact (e.g. "2 beds" → "1
    bed"). Works on a pending or already-approved booking; the capacity guard
    still runs at `review_cabin_stay()` time, not here. `EditBookingSheet`
    calls this alongside `set_booking_rooms` so the whole request — dates,
    headcount, notes, and room picks — is editable in one sheet.

- **Room pick is optional; decision + edit emails are opt-in per action**
  (migrations [`0104`](supabase/migrations/0104_cabin_review_email_toggle.sql)–
  [`0107`](supabase/migrations/0107_cabin_notification_room_status.sql)) —
  for booking (incl. on behalf of someone who doesn't use the app),
  [`CabinRequestSheet`](components/CabinRequestSheet.tsx) has a **"Not sure
  yet"** checkbox that skips the room pick entirely instead of forcing one; a
  request/booking can sit with zero rooms attached indefinitely.
  - **`review_cabin_stay`** grew `p_notify` (default true): unchecking "Email
    them a confirmation" in [`AdminCabinBookings`](components/AdminCabinBookings.tsx)
    (or the `forUser` auto-approve flow in `CabinRequestSheet`) pre-stamps
    `decision_email_sent_at` at review time, which "claims" the row the same
    way the mini's alert-mailer does — so it silently skips the send. No new
    column needed.
  - **`admin_update_cabin_booking`** grew `p_notify` (default **false** — most
    edits are small corrections that don't warrant a new email): checking
    "Email them about this update" in `EditBookingSheet` stamps
    `edit_notify_requested_at`; the mailer claims by advancing the sibling
    `edit_email_sent_at` column to match, so each edit can independently
    trigger (or skip) its own notice.
  - **`request_cabin_stay`** grew `p_notify` (default true, migration
    [`0108`](supabase/migrations/0108_cabin_request_notify_toggle.sql)) —
    stamped onto a new `request_notify` column (unlike the claim-a-row tricks
    above, `notif_on_cabin_request` fires synchronously in the same INSERT, so
    there's no later row to claim). When false, admins get **no** in-app
    notification and **no** phone push for that request — `push-sender.js`'s
    `handleCabinRequest` checks the same column. No UI wired to this yet
    (there's no "don't notify admins" checkbox in `CabinRequestSheet`); it's a
    plumbing-only escape hatch for testing the booking flow (e.g. a real SQL/
    RPC test booking) without spamming every admin.
  - **Cancellation email** (migration
    [`0109`](supabase/migrations/0109_cabin_cancel_notify.sql)) —
    `cancel_cabin_stay` grew `p_notify` (default true) + `cancelled_by`/
    `cancel_email_sent_at` columns, same claim-a-row shape as the decision/edit
    emails: cancelling pre-stamps `cancel_email_sent_at` (skipping the mailer)
    whenever the **requester cancels their own** booking or `p_notify` is
    false — an admin cancelling someone else's stay is the only case that
    leaves it null for the mailer's new `handleCabinCancel` to pick up.
    `cancelStay()` in [`lib/cabins.ts`](lib/cabins.ts) takes an optional
    `notify` (default true); no UI checkbox wired yet (both call sites —
    `AdminCabinBookings`, `request-stay`'s `BookingRow` — just use the
    default).
  - **Mailer reliability.** The mini's Supabase Realtime channel can silently
    drop (`CHANNEL_ERROR`/`TIMED_OUT`) with no built-in recovery, which
    previously meant a decision/edit/cancel could sit unsent until someone
    noticed and restarted the mini. `alert-mailer.js` now (1) resubscribes
    5s after a dropped channel instead of staying dead, and (2) re-runs its
    startup sweep (alerts + cabin decisions/edits/cancellations) on a
    recurring 3-minute timer, not just once at boot — so a missed realtime
    event self-heals within a few minutes either way.
  - **Self-service room pick.** `set_booking_rooms` was admin-only; it now
    also allows the booking's own requester (`user_id = auth.uid()`), so
    someone booked without a room (by themselves or by an admin on their
    behalf) can come back to **Cabin Bookings → Your requests** and pick
    their own room once they know, via the new
    [`PickMyRoomSheet`](components/PickMyRoomSheet.tsx) (`app/request-stay/page.tsx`'s
    `BookingRow` shows a "Choose your room" affordance whenever the booking
    has no room and its cabin uses named rooms). Picking a room blocks it off
    from other bookings the same way the admin flow does — same RPC, same
    overlap check.
  - **`cabin_booking_notification`** (the mini's service-role-only info
    fetcher) now also returns `room_names` + `cabin_has_rooms`, so the
    approval-confirmation and edit-notice emails can nudge an unassigned
    requester: "No room picked yet — open the app… and tap Choose your room."
  - **An unassigned approved booking still counts against availability**
    (migration [`0108`](supabase/migrations/0108_cabin_availability_unassigned_bookings.sql)) —
    `cabin_availability()`'s room-based branch previously only subtracted
    rooms reserved via `cabin_booking_rooms`, so an approved "Not sure yet"
    booking was invisible to the "X of Y rooms left" card (a cabin could
    read 4/4 free with a real guest already coming). It now also subtracts
    one slot per approved, room-less booking overlapping the range —
    mirroring the cabin-wide capacity math `review_cabin_stay()` already
    used for a room-less booking's own approval check.

## Content safeguards (feed moderation)

Layered safeguards on the social surfaces (Posts + comments, **committee/house
chat**, and uploaded media) so sensitive/inappropriate/illegal content doesn't
sit in front of the family. Full writeup in
[`docs/content-moderation.md`](docs/content-moderation.md). Posts stay
**post-moderated** (still go live instantly) but anything a filter trips is
**held for admin review** — a `status` of `visible | pending | hidden` on
`posts`/`post_comments` **and `committee_messages`/`house_messages` (migration
[`0128`](supabase/migrations/0128_chat_moderation.sql))**; RLS only returns
non-`visible` rows to the author + admins, so held/removed content drops out of
the feed/room without being destroyed. **Live now (Tiers 0+1+2):**
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
- **Tier 2 (AI, on the mini — LIVE):** every uploaded photo/video is graded by
  Apple's models through the mini's local `fm serve`
  ([`media-server/moderation.js`](media-server/moderation.js)) — **Private Cloud
  Compute preferred** (it works via the Login-Item `fm serve`, no entitlement),
  on-device fallback. It grades a **downscaled copy** (walks 1024→768→512, drops
  a rung on a 413) and **retries** transient PCC/fm-serve blips before failing
  open, so checks actually run; anything that couldn't be checked during an
  outage is re-queued and re-checked once the model is back
  ([`media-server/moderation-backfill.js`](media-server/moderation-backfill.js)).
  A flagged verdict is written to `media_moderation` (keyed by the media URL); a
  trigger then holds the parent **post** (0043) or **chat message** (0128).
  **The Main Feed moderates at post time; CHAT is optimistic** — a chat message
  posts instantly and the mini checks its media ASYNChronously, so a flagged
  verdict *retroactively* holds the message a few seconds later (the
  media_moderation trigger, 0128). Chat text also rides the deterministic
  blocklist floor. A dedicated `SensitiveContentAnalysis` nudity/CSAM signal is
  still a possible future add (see the doc) — **no third-party CSAM API exists**.

Data model: migrations [`0040`](supabase/migrations/0040_content_moderation.sql)
(`status` columns + status-aware RLS, `moderation_blocklist`, `content_reports`,
`content_moderation_events`, the `moderate_content_text`/`apply_content_report`
triggers, and the `report_content`/`set_content_status`/`moderation_queue` RPCs),
[`0043`](supabase/migrations/0043_media_moderation.sql) (`media_moderation` +
the post-media hold trigger), and [`0128`](supabase/migrations/0128_chat_moderation.sql)
(chat `status` + read RLS + the media_moderation retroactive-hold trigger +
extending the queue/blocklist/set-status to chat; also fixes a latent post bug
where the member-edit status pin reverted the automated holds).

⚠️ **Incident: 0128 silently regressed whole-word blocklist matching (fixed by
[`0160`](supabase/migrations/0160_restore_blocklist_whole_word.sql)).**
[`0044`](supabase/migrations/0044_blocklist_whole_word.sql) had fixed
`moderate_content_text()` to match single-word blocklist terms as **whole
words**, not substrings — otherwise a public profanity seed list
(`media-server/seed-blocklist.js`) over-flags ordinary fishing-resort words
that merely *contain* a blocked fragment ("bass"/"class"/"glass"/"assist"
all contain "ass", "hello"/"shell" contain "hell", etc). 0128 recreated the
same function (to extend it to committee/house chat) directly off the
**original 0040 version**, not 0044 — silently reintroducing plain substring
matching (`ilike '%pattern%'`). Live impact: one post got auto-held as a
false positive, and — since it's the same regressed matcher, not something
specific to that post — every post/comment/chat message containing an
ordinary word with a blocked fragment inside it kept getting silently
auto-held afterward, for everyone, with the composer's success toast still
claiming "Posted — everyone can see it now" (see the `PostsView.tsx` fix
below), so it looked like posting itself had broken rather than one specific
row being held. 0160 re-recreates `moderate_content_text()` with 0128's
structure (chat branches + the `mlr.mod_bypass` GUC) but restores 0044's
tokenized whole-word matching. **Takeaway for future edits to this
function:** always `create or replace` it starting from the CURRENT
production definition (or diff against the previous migration that touched
it), never from an older migration's copy-pasted body — Postgres has no way
to detect that a "recreate" silently dropped an unrelated prior fix.
[`PostsView.tsx`](components/PostsView.tsx)'s post composer was also fixed to
stop always showing "Posted — everyone can see it now ✓" — it now re-reads
the created row's actual `status` and shows a "held for admin review" message
when the trigger auto-holds it, so a future legitimate (or erroneous) hold is
immediately visible to the poster instead of looking like silent failure.

## Conversation search (semantic, on-device)

A search box at the **foot of the Feed conversation list** ([`FeedView`](components/FeedView.tsx))
lets a member **search every conversation they can see — by meaning, not exact
words** ("the plumbing problem upstairs" finds "leak in the second-floor
bathroom"). It spans the resort **Family Feed** (posts + comments), their
**committee/area chats**, and their **house chat**, and each result taps through
to the source message (reusing the existing `?c/&area/&m`, `?house/&m`, `?post`
deep-links, so the room scrolls to + flashes the message like an Activity
deep-link).

**The RLS guarantee.** Content is embedded **once** into a single **locked**
table (`content_embeddings`, migration [`0129`](supabase/migrations/0129_semantic_search.sql) —
no anon/authenticated grant, deny-all RLS). Search is a `SECURITY DEFINER` RPC
**`search_conversations(query_embedding, match_count)`** that re-applies the
**exact same visibility rules** the Feed/chat screens use — reusing
`can_access_committee_area` (0063) and `is_house_member` (0064) plus the
members-only / `status='visible'` / not-`deleted_at` gates. Because `auth.uid()`
inside a DEFINER function still resolves to the **calling** member, each person
searches exactly their own slice — join a committee and its history is instantly
searchable; leave and it's gone — **with no per-user index to maintain**. The
mini's `/search` endpoint forwards the caller's own Supabase token so the RPC
runs *as them*; it never uses the service-role key for search.

**All on-device / on the mini** (no cloud AI, tied to the author's Apple-only
constraint via the mini):
- **`media-server/embed-service/`** — a small Swift/Vapor microservice
  (`POST /embed`, loopback :8786, launchd `com.mlr.embed-service`) that turns
  text into 512-d L2-normalized vectors with Apple's **NaturalLanguage**
  `NLContextualEmbedding`. Deliberately **separate from `fm-service`** and does
  NOT import FoundationModels — so the FM-generation SIGTRAP on the current beta
  can't take search down. (Apple's FM LLM / `fm serve` has **no** embeddings
  endpoint; NaturalLanguage is the right on-device tool.) Build/deploy:
  `embed-service/scripts/build-restart.sh`. Its shared secret + URL live in
  `media-server/.env` (`EMBED_SHARED_SECRET`, `EMBED_URL`).
- **[`media-server/search-indexer.js`](media-server/search-indexer.js)** — a
  side-job (like the moderation backfill) that reconciles `content_embeddings`
  every ~2 min: embeds new/edited posts + chat (service-role → embed-service →
  upsert) and prunes orphans (deleted/soft-deleted). It indexes *all* statuses;
  search-time RLS is the only scoping. Tolerates embed-service down / migration
  not yet run (logs + retries).
- **`POST /search`** in [`media-server/server.js`](media-server/server.js) —
  `requireUser` → embed the query on the mini → call `search_conversations` as
  the caller (RLS) → return results. Client seam [`lib/search.ts`](lib/search.ts);
  UI [`ConversationSearch`](components/ConversationSearch.tsx).

**Ranking is keyword-precise (migrations [`0130`](supabase/migrations/0130_search_hybrid.sql)
+ [`0131`](supabase/migrations/0131_search_keyword_precision.sql)).**
Apple's mean-pooled vectors are anisotropic (cosine sims bunch in a narrow
~0.85–0.92 band), so pure semantic can't separate relevant from irrelevant and
read as "everything, unfiltered". `search_conversations` now filters strictly by
**Postgres full-text match** (`to_tsvector @@ websearch_to_tsquery`), ordering by
`ts_rank` then embedding similarity. `query_text` was added to the RPC (with a
default, so the call is backward-compatible); media-server's `/search` passes it.
- ⚠️ **Filter with `@@`, never `ts_rank(...) > 0`** — ts_rank returns a tiny
  non-zero (~1e-20) for NON-matching multi-word queries, so `> 0` leaks the whole
  corpus in under the real hits (the 0130 bug; single-word queries returned exactly
  0 and hid it). No keyword match ⇒ zero rows ⇒ the UI shows "No matching messages".
- The embedding vectors now only **break ties** among keyword matches. The "find
  it without the exact words" semantic behavior is intentionally OFF (the vectors
  are too anisotropic to threshold). Restoring it cleanly would need **mean-centering**
  the embeddings so a similarity cutoff becomes meaningful — a future enhancement,
  not wired.

**Go-live order** (search shows an error state until all three are done):
(1) run migration 0129 in Supabase; (2) build + launchd-install embed-service on
the mini; (3) `git pull` + restart media-server (indexer backfills, `/search`
works). The web UI degrades to a clean "Search is unavailable" until then.

## Backend seams (planned, not yet wired)

These are built UI-first with the swap point isolated to one module each:

| Feature | Seam today | Becomes |
|---|---|---|
| Google-Drive-fed announcements | [`lib/announcements.ts`](lib/announcements.ts) `getAnnouncements()` | server route reading a Drive file (API or published CSV/JSON), revalidated / webhook-pushed |
| Google-Calendar events feed | [`lib/events.ts`](lib/events.ts) `fetchGcalEvents()` (returns `[]`) | fetch + parse a **published Google Calendar ICS** (`NEXT_PUBLIC_GOOGLE_CALENDAR_ICS_URL`, no OAuth) → `ResortEvent[]` (`source: "gcal"`), merged in `fetchEvents()` |
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

**Tapping a push must land on its deep link ([`PushDeepLink`](components/PushDeepLink.tsx)).**
`sw.js`'s `notificationclick` called `client.navigate(url)` inside a `try/catch`
that swallowed the failure and then `return client.focus()`ed regardless — so
wherever `navigate()` is unsupported and rejects (an **installed PWA**, iOS
especially — which is how most of the family runs this) a tap merely focused the
app on whatever page it was already showing and the deep link was silently
dropped. "Cass shared a new post" left you hunting the feed by hand. Three
routing paths now, in reliability order: (1) `navigate()` — spec'd, guaranteed
correct where supported; (2) **`postMessage` → the app routes with its own
router**, the new `PushDeepLink` client component mounted in `layout.tsx` — the
path that actually works in an installed iOS PWA, and it stays a client-side
transition instead of a reload; (3) `openWindow()` when nothing suitable is
open. `matchAll` results are also filtered to **same-origin** windows first
(only those can be navigated/messaged, and it can return others), and
`PushDeepLink` re-resolves the url against `window.location.origin` and drops
anything cross-origin before routing. Because it routes via `router.push()`,
the patched `history.pushState` fires `mlr:locationchange` → `useUrlParam`
re-reads `?post=` / `&m=` → `useDeepLinkFlash` scrolls to + flashes the item,
identical to tapping the row in the Activity tab.

**...and land on the specific COMMENT, not just the post (migration
[`0164`](supabase/migrations/0164_comment_notification_deep_link.sql)).**
`PushDeepLink` getting a tap to the right *post* still left a `post_comment`/
`post_reply`/`post_mention` notification dropping you at the top of a
(possibly long) comment thread to hunt for the one being talked about — the
same "find it yourself" problem, one level down. `notif_on_post_comment()`/
`notif_on_post_mention()` now append `&comment=<comment id>` to the url they
already build; `PostsView.tsx` reads it with a **second, independent**
`useDeepLinkFlash("comment-", …)` instance (alongside the existing
`"post-"` one — the hook has no shared state, so both run side by side) and
scrolls to + flashes that specific comment bubble once it's in the DOM.
Comments render unpaginated (every comment for a loaded post is always in the
DOM), so there's no "expand thread first" step needed. Existing/older
notification rows keep their post-only url — a harmless degrade, not a
migration-time backfill.

**Realtime reconnect hardening.** `push-sender.js` and `apns-sender.js`
(the APNs counterpart) each ran a single `.subscribe()` with no recovery —
the same silent-drop failure mode documented in **Cabin stays**' "Mailer
reliability" (`alert-mailer.js`'s Supabase Realtime channel can go
`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` with no built-in reconnect). The mailer
was hardened for this; the two push senders were not, so a dropped channel
meant **every push silently stopped** — chat, alerts, feed-mirrored
notifications, all of it — until someone noticed and restarted the mini,
with nothing in the logs pointing at why (posts/comments/etc. still work
fine, since those are plain Supabase writes from the browser that never
touch the mini). Both senders now resubscribe 5s after a dropped channel,
matching `alert-mailer.js`'s pattern (there's no per-push "unsent row" to
sweep as a backstop the way email has, so reconnect-on-drop is the whole
fix here, not just the fast path).

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
**A new Main Feed post rides a phone push too** — `new_post` is a `PushType`
(in `PUSHABLE_FEED_TYPES`/`PUSHABLE` on both mini senders + a
[`PushToggle`](components/PushToggle.tsx) row, "New posts in the Feed") and is
**ON by default**: it's in `DEFAULT_PUSH_TYPES` for new opt-ins, and existing
push-on members were backfilled by migration
[`0161`](supabase/migrations/0161_new_post_push_default.sql) (mirroring 0159's
`signup_reminder` / 0037's `help_request` backfill — only members with push on
at all; a fully-push-off member stays off). It shipped opt-in/off-by-default
first, on the theory that it's the highest-frequency category — **reversed by
product decision**: the family feed is the app's town square, and during a live
fest a post ("dinner is ready!") is exactly what people need to hear
immediately, so an in-app-only Activity row nobody sees until they open the app
defeats the purpose. Still individually opt-OUT-able, so anyone who doesn't
want it unticks that one row rather than killing push entirely. The in-app
`new_post` Activity row is unchanged (also on by default, in `NotifPrefs`).
No schema change was ever needed — `push_types` is a plain `text[]` with no
allow-list constraint, so 0161 is a pure data backfill.

**A comment on YOUR post rides a phone push too** — `post_comment` is a
`PushType` (same wiring as `new_post`: both mini senders + a `PushToggle` row,
"Comments on my posts") and is **ON by default**, backfilled by migration
[`0163`](supabase/migrations/0163_post_comment_push_default.sql). The gap this
closed: `post_reply` (notifying every OTHER member who'd already commented on a
post) was already pushable, but `post_comment` — notifying the post's OWN
AUTHOR — was in-app only, so the one person most invested in a post's comments
was the one not getting pinged. Still individually opt-OUT-able.

⚠️ **Audit finding, fixed: `help_request`/`help_response` had no `PushToggle`
row.** Both are real `PushType` values, default-on (`DEFAULT_PUSH_TYPES`), and
correctly gated in both mini senders' pushable sets — but
[`PushToggle`](components/PushToggle.tsx)'s `TYPES` list never had a row for
either, so a member had no way to see or opt OUT of these two specifically
(only the blunt "turn off push entirely" master switch). Fixed by adding both
rows (mirroring `NotifPrefs.tsx`'s existing wording). Every `PushType` now has
an exactly-matching `PushToggle` row — verified by diffing the `PushType` union
against `TYPES`' `value`s; keep them in sync when adding a new push category.
**Independent of push** (it
works even if the mini is down; the chat firehose stays out — only chat
@mentions land here). Pieces: the [`/notifications`](app/notifications/page.tsx)
route → [`NotificationsView`](components/NotificationsView.tsx); the bell tab +
live unread **badge** in [`TabBar`](components/TabBar.tsx) via
[`useUnreadNotifications`](lib/hooks.ts); per-member kind prefs
([`NotifPrefs`](components/NotifPrefs.tsx) → `profiles.notif_types`); and an admin
sender (the "🔔 Activity tab" channel of
[`AdminBroadcastComposer`](components/AdminBroadcastComposer.tsx), see **Reach
everyone** → `send_broadcast_notification`) that targets **Everyone / Admins**.
**Read model:** `seen_at` drives
the badge (opening the tab clears it), `read_at` drives per-item bold, `expires_at`
drops an item from the badge while keeping it in the list.
**Data model:** [`0029`](supabase/migrations/0029_beta_tester_and_notif_prefs.sql)
(`notif_types`) +
[`0030`](supabase/migrations/0030_notifications_feed.sql) (the `notifications`
table, fan-out triggers on the source tables, and the `mark_*` /
`send_broadcast_notification` RPCs). Rows are written **only** by SECURITY DEFINER
triggers/RPCs (no client insert); members can read/dismiss their own. (The
former **Beta Tester** admin-assigned role/audience — `profiles.beta_tester`,
`set_beta_tester` — was removed in migration
[`0100`](supabase/migrations/0100_remove_beta_tester.sql).)

**Mac-mini media server** ([`media-server/`](media-server/)) also now
**transcodes uploaded videos** to web-friendly ≤1080p H.264 MP4 via `ffmpeg`
([`transcode.js`](media-server/transcode.js)) — photos are left full quality —
and hosts the optional [`alert-mailer.js`](media-server/alert-mailer.js) +
[`push-sender.js`](media-server/push-sender.js) side jobs alongside uploads.
The AI moderation path ([`moderation.js`](media-server/moderation.js)) uses
`sharp` to downscale a **copy** of each image/sampled video frame to ≤1024px
before base64 — the local `fm serve` classifier caps the request body at 1 MB, so
full-res phone photos would otherwise 413. The stored/served media is untouched.
It's also been **hardened**: CORS fails closed (an unset/empty
`ALLOWED_ORIGINS` no longer means "allow everything"), per-endpoint rate limits
(`/upload` 30/hour, `/moderate/text` 60/min, `/geocode` 30/min, `trust proxy`
aware), `/geocode` now requires sign-in (same `requireUser` check as
`/upload`), `helmet` adds baseline security headers (CSP intentionally off —
see the README), and the `MAX_MB` upload cap default dropped to **256** (was
1024). See [`media-server/README.md`](media-server/README.md) for the full
list and the `npm install` + restart needed on the mini.

**Remote restart, from the app — owner-only.** Shipping a media-server
change still needs a `git pull` + process restart on the mini, but that no
longer requires someone at the machine: Admin → **Media server**
(`/admin/system`, [`AdminMediaServer`](components/AdminMediaServer.tsx))
shows the running commit + how far behind `origin/main` it is and a "Pull
latest & restart" button. Deliberately **narrower than every other admin
tool** — restarting the process is an infrastructure control, not app
content, so it's gated to exactly one account by verified email
([`lib/owner.ts`](lib/owner.ts) `OWNER_EMAIL`/`isOwner()`) rather than the
broader `profiles.is_admin` flag every app admin has: the dashboard card
(`app/admin/page.tsx`'s `ownerOnly` card flag) and the `/admin/system` page
itself both hide it from a non-owner admin, and the mini's own
`requireOwner` middleware (media-server/server.js — checks the caller's
GoTrue-verified email directly, no `profiles` lookup needed) re-enforces the
same restriction server-side regardless of what the client shows. It calls
`POST /admin/restart-media-server` — a fast-forward-only `git merge` (409s
rather than force-pushing over a diverged checkout), a conditional
`npm install` only if `media-server/package.json`/`package-lock.json`
changed, then `process.exit(0)`. No `launchctl` call needed: the launchd
plist (`com.mlr.media-server.plist`) already sets `KeepAlive`, so it
relaunches on its own within the 10s `ThrottleInterval`, on the new code.
`GET /admin/media-server-status` (same `requireOwner` gate) backs the status
line the card shows before you tap anything.

## Loading stability & the SWR cache

The app's anti-flash layer — why cards don't pop in on cold open and why the
first paint is the correct member view. Two small modules:

- [`lib/swrCache.ts`](lib/swrCache.ts) — **`useCachedResource(key, empty,
  fetcher, { persist?, ttlMs? })`**, the shared stale-while-revalidate
  primitive that replaced the ~20 hand-rolled per-component cache Maps. Two
  layers: a module **memory Map** (survives the per-tab-switch remounts caused
  by `app/template.tsx`) and an optional **persisted copy**
  (`localStorage`/`sessionStorage`, key prefix `mlr.cache.v1.`, `{ts, data}`
  envelope, default 24h TTL, 200KB per-entry cap) so the *next app open*
  paints the last known data instantly and revalidates in the background.
  In-flight fetches are deduped per key; `mutate()` writes state + memory +
  storage in one call (optimistic updates); `reload()` forces a fresh fetch
  (realtime callbacks use it). Also exports `readPersisted`/`writePersisted`
  (used directly where a hook doesn't fit — IdentityProvider, FeedView,
  useEvents) and `clearAllCaches()`.
- [`lib/appReady.ts`](lib/appReady.ts) — the first-paint readiness registry
  behind the splash hold (see the splash paragraph up top): `markPending(key)`
  on a cold load, `onQuietOnce(capMs, cb)` in `SplashIntro`.

**The four rules** (break any of them and you get hydration mismatches or
cross-account bleed):

1. **Memory seeds sync, storage seeds post-mount.** The prerendered HTML is
   always the guest/empty view, so the first client render must match it.
   Module memory is empty at cold boot (safe to read in a `useState`
   initializer); persisted snapshots are read **only inside effects** — never
   move one into an initializer "because it's faster".
2. **User-scoped keys embed the auth uid** (`myHouse.<uid>`, `feed.<uid>`,
   `events.<uid|guest>`, `calloutsDone.<uid>`, `unread.<uid>`,
   `workChecklist.<uid>`, `activePoll.<uid>`, `polls.<uid>`, `people.<uid>`,
   `notifFeed.<uid>`, `helpRequests.<uid>`, `festMember.<uid>`,
   `postsFeed.<uid>` (a TRIMMED top-of-feed snapshot — see PostsView),
   `resolvedHouse.<uid>.…`, `chatEntry.<uid>.<slug>`,
   `managedCommittee.<uid>.<slug>.<admin>`,
   `meetings.<uid>.<roomKey>` (roomKey = `c:<slug>|<area>` or `h:<houseId>`),
   `houseCalendar.<houseId>`; day-fresh data also embeds the local date —
   `whosUpNorth.<uid>.<date>`, `birthdays.<uid>.<date>`,
   `onThisDay.<uid>.<date>`). Pass `key = null` while the uid is unresolved —
   the hook stays inert. Public data uses unscoped keys (`festContent`,
   `appImages`, `weather`).
3. **Preview mode never persists.** While an admin is viewing-as, pass
   `persist: undefined` and put the preview id in the (memory-only) key.
4. **`signOut()` calls `clearAllCaches()`** — every `mlr.cache.*` key in both
   storages plus the memory map, so nothing outlives an account switch on a
   shared device. Uid-scoped keys are the backstop for the token-expiry path
   where signOut never runs (leftover entries are inert without a session).

Everything is stale-while-revalidate: a seed **always** gets a background
refetch, so revoked access / deleted rows self-correct, and realtime
subscriptions keep writing through `reload`/`mutate`. Migrated so far:
useFestContent, useAppImages, useEvents, useUnreadNotifications,
useHelpRequests, useResolvedHouse, useHouseCalendar, FeedView, HouseHubCard,
HomeSpotlight (callout completions), WeatherCard, ActivePollCard,
WorkChecklist, WhosUpNorth/Birthdays/OnThisDay, PollsView, PeopleDirectory,
NotificationsView, FestStatus + FamilyFestSpotlight (one shared
`festMember.<uid>` key — a deduped fetch across both), ChatEntryButton,
useManagedCommittee, PostsView (the Main Feed: a trimmed `postsFeed.<uid>`
snapshot of the top ~15 posts + their comments/reactions/members — never the
full history, which would blow the 200KB cap), the chat rooms
(CommitteeChat `chatRoom.<uid>.<slug>|<area>` / HouseChat
`houseChatRoom.<uid>.<slug>` — the last ~30 messages + access/roster per
room, trimmed like the Main Feed; an owner-approved trade-off since members
can see those rooms anyway, uid-scoped and wiped on signOut like everything
else), plus the identity snapshot. Still on bespoke memory-only caches
(fine — behind navigations, adopt opportunistically): CommitteeRoster,
CommitteeJoin, CommitteeEmailMembers, and the `Admin*` caches.

## Conventions

- **Theme** — all colors are CSS variables in the `@theme` block of
  [`app/globals.css`](app/globals.css). Tailwind v4 turns each `--color-*` into
  `bg-*` / `text-*` / `ring-*` / `border-*` utilities. Never hard-code hex in
  components; add or edit a token. Palette: `--color-primary` = forest green
  (`#15503a`, the logo), `--color-accent` = vintage chestnut, on a near-white
  page. The resort wordmark uses `.font-script` (Yellowtail, via next/font).
  `--color-fest` is the Family Fest heraldic wine for fest-branded accents
  *outside* `.ff-section` (e.g. the TabBar's Family Fest tab + live dot).
  `--color-muted` / `--color-faint` are the readability floor for
  secondary/caption text (timestamps, subtitles, helper text) — use these
  instead of an opacity modifier on `text-foreground` (e.g. `text-foreground/40`
  reads too faint for older eyes); swept across ~40 components. `--color-venmo`
  / `--color-paypal` tokenize the third-party pay-button brand colors
  (`PayView`) so no hex is hard-coded there either.
  - ⚠️ **LIGHT MODE ONLY — never add a dark theme.** And **never** use a dark
    translucent surface tint (`bg-black/NN`, `bg-zinc-*/NN`) as a card/panel bg —
    it goes muddy grey on light (a recurring issue across the author's apps).
    Translucent layers stack LIGHT; `bg-black/NN` is OK only as a modal scrim.
- **Cross-nav** — the **Family Fest** bottom tab → `/family-fest` overview, then
  the in-section [`FamilyFestNav`](components/FamilyFestNav.tsx) sub-nav switches
  between Dinners / Pay (photos live only on the Feed tab). There's no
  "Schedule" pill — the Overview already renders the full week via `FestWeek`,
  so a separate Schedule tab was just showing that same accordion a second
  time; the standalone `/family-fest/schedule` route is still there for any
  direct link but nothing points at it anymore. All internal routes — no
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
  (commit SHA via `VERCEL_GIT_COMMIT_SHA`/`GITHUB_SHA`, a timestamp locally)
  into the bundle **and** writes `public/version.json` — both from one source
  in [`next.config.ts`](next.config.ts) so they can't disagree (`version.json`
  is gitignored — it's a build artifact). [`UpdateBanner`](components/UpdateBanner.tsx)
  (mounted in [`layout.tsx`](app/layout.tsx)) polls `version.json` (on focus +
  every 5 min, `no-store`) and shows a one-tap **Refresh** bar when it differs
  from the running id — so a Home-Screen PWA stuck on an old build gets nudged
  instead of going silently stale, without a manual close/reopen. Refresh clears
  Cache Storage then reloads (the shell is served `must-revalidate`; `sw.js`
  doesn't cache).

## Keep this current

When you add a route, dependency, env var, or change the data model, update
this file and `README.md` in the same commit. Doc drift is the only failure
mode that makes these files harmful.
