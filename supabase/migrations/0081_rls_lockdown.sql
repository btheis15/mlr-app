-- 0081_rls_lockdown.sql
-- Make the database enforce the privacy wall that has been UI-only until now.
--
-- The app is browse-first: a guest (no session, anon key) can look around, and
-- the client hides sensitive info behind Guard.tsx / lib/privacy.ts. But that
-- was only the UI layer — every table below still had a `using (true)` SELECT
-- policy, so anyone with the (public, in-bundle) publishable key could read the
-- member directory, RSVPs, posts, and rosters straight from PostgREST. This
-- migration flips those reads to members-only (`auth.uid() is not null`) so a
-- scraper gets nothing the guest UI wouldn't show, and adds a `public_profiles`
-- view (first name + avatar only) so the guest browse experience keeps names
-- next to faces.
--
-- Locked to members (SELECT now requires a session):
--   profiles, posts, post_comments, post_media, post_tags, albums,
--   post_reactions, post_comment_mentions, committee_roster, event_attendance,
--   work_items (the MLR `house_id is null` branch too), houses.
--
-- DELIBERATELY LEFT PUBLIC (guest browse content, no PII):
--   • events           — the resort calendar is the browse-first pitch; who's
--                        COMING (event_attendance) is members-only, the events
--                        themselves are not.
--   • cabins           — static cabin/room descriptions.
--   • announcements    — the banner is shown to everyone by design.
--   • committees       — committee names/descriptions (the seed is in the
--                        bundle anyway); the roster of PEOPLE is what's locked.
--   • committee_areas  — the area allow-list (labels only).
--   • app_images       — decorative imagery.
--   • fest_content_*   — schedule/dinners/things-to-do (0053): Family Fest
--                        program content, same public tier as events.
--
-- Member-to-member visibility of profile contact/pay fields is INTENTIONAL —
-- it's a family directory — so member reads of `profiles` are not narrowed.
--
-- Client note: guests fall back to `public_profiles` for names/avatars
-- (CommitteeRoster, member deep-links); those reads catch a missing relation
-- (42P01) and drop back to the old `profiles` read, so the app keeps working
-- if this migration hasn't been applied yet.
--
-- Apply in the Supabase SQL editor (after 0080).

-- ── profiles: members-only, plus the guest-safe view ─────────────────────────
drop policy if exists "profiles: public read" on public.profiles;
drop policy if exists "profiles: member read" on public.profiles;
create policy "profiles: member read"
  on public.profiles for select
  using (auth.uid() is not null);

-- The guest tier: id + FIRST NAME ONLY + avatar, nothing else. Masking happens
-- server-side (split_part), so a guest can't fetch the full display_name at
-- all. `security_invoker = off` (the Postgres 15+ default for views, pinned
-- here to be explicit) makes the view read with its OWNER's rights — the
-- migration runs as `postgres`, which owns `profiles` and therefore bypasses
-- its RLS — which is exactly the point: a controlled, column-shaped hole in
-- the members-only policy above. Supabase's advisor flags SECURITY DEFINER
-- views; this one is intentional and exposes no private columns.
drop view if exists public.public_profiles;
create view public.public_profiles
  with (security_invoker = off)
as
  select
    id,
    split_part(trim(coalesce(nullif(display_name, ''), full_name, '')), ' ', 1) as display_name,
    avatar_url
  from public.profiles;

comment on view public.public_profiles is
  'Guest-safe profile tier (0081): first name + avatar only. Reads bypass the members-only profiles RLS by design.';

-- SELECT only. A single-table view is auto-updatable in Postgres and writes
-- through an owner-rights view would bypass profiles' RLS entirely — and
-- Supabase's default privileges hand new public relations to anon/
-- authenticated — so strip everything, then grant back just the read.
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated;

-- ── Posts + social: members-only, keeping the 0040 moderation logic ──────────
-- The status-aware branch from 0040 (author sees their own held item, admins
-- see everything) is preserved — it's ANDed with the sign-in check, never
-- clobbered. Guests hit the SignInWall in the UI anyway; now the DB agrees.
drop policy if exists "posts: public read" on public.posts;
drop policy if exists "posts: member read" on public.posts;
create policy "posts: member read" on public.posts for select using (
  auth.uid() is not null
  and (
    status = 'visible'
    or author_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
);

drop policy if exists "comments: public read" on public.post_comments;
drop policy if exists "comments: member read" on public.post_comments;
create policy "comments: member read" on public.post_comments for select using (
  auth.uid() is not null
  and (
    status = 'visible'
    or author_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
);

drop policy if exists "media: public read" on public.post_media;
drop policy if exists "media: member read" on public.post_media;
create policy "media: member read" on public.post_media for select
  using (auth.uid() is not null);

drop policy if exists "tags: public read" on public.post_tags;
drop policy if exists "tags: member read" on public.post_tags;
create policy "tags: member read" on public.post_tags for select
  using (auth.uid() is not null);

drop policy if exists "albums: public read" on public.albums;
drop policy if exists "albums: member read" on public.albums;
create policy "albums: member read" on public.albums for select
  using (auth.uid() is not null);

drop policy if exists "reactions: public read" on public.post_reactions;
drop policy if exists "reactions: member read" on public.post_reactions;
create policy "reactions: member read" on public.post_reactions for select
  using (auth.uid() is not null);

drop policy if exists "comment mentions: public read" on public.post_comment_mentions;
drop policy if exists "comment mentions: member read" on public.post_comment_mentions;
create policy "comment mentions: member read" on public.post_comment_mentions for select
  using (auth.uid() is not null);

-- ── People-adjacent tables: members-only ─────────────────────────────────────
-- The roster carries names + emails + phones (0056) — the exact PII the wall
-- exists for. Guests keep the static in-code seed (first-name-masked) instead.
drop policy if exists "committee_roster read" on public.committee_roster;
drop policy if exists "committee_roster member read" on public.committee_roster;
create policy "committee_roster member read" on public.committee_roster for select
  using (auth.uid() is not null);

-- Who's coming to an event is member info; the event itself stays public.
drop policy if exists "event_attendance: public read" on public.event_attendance;
drop policy if exists "event_attendance: member read" on public.event_attendance;
create policy "event_attendance: member read" on public.event_attendance for select
  using (auth.uid() is not null);

-- Work items: keep the 0066 house scoping intact (a house item is only visible
-- to that house's members), and the MLR branch (`house_id is null`) — public
-- until now — becomes members-only too. The guest UI shows a sign-in line.
drop policy if exists "work_items: public read" on public.work_items;
drop policy if exists "work_items: scoped read" on public.work_items;
drop policy if exists "work_items: member scoped read" on public.work_items;
create policy "work_items: member scoped read" on public.work_items for select
  using (auth.uid() is not null and (house_id is null or public.is_house_member(house_id)));

-- House names are family-internal structure; nothing a guest needs.
drop policy if exists "houses: public read" on public.houses;
drop policy if exists "houses: member read" on public.houses;
create policy "houses: member read" on public.houses for select
  using (auth.uid() is not null);
