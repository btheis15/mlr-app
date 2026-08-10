-- Require a VERIFIED (admin-approved) member for every members-only read.
--
-- 0181/0182 added the flag and auto-approved everyone already known. This is the
-- half that actually enforces it: until now `approved` gated only the photo albums
-- (via the media server's token), while posts, contact details, RSVPs and the rest
-- were readable by ANY signed-in account — and anyone can sign up with any email.
--
-- ⚠️ WHY THIS IS WRITTEN OUT LONGHAND INSTEAD OF A FIND/REPLACE
--
-- Every policy below was read from pg_policies (its LIVE definition), not from the
-- migration that created it. Twelve of them carry logic beyond "is signed in", and
-- replacing them wholesale with `is_approved_member()` would have silently deleted
-- it:
--
--   posts / post_comments / drop_box_media  moderation status
--        (status = 'visible' OR mine OR admin). Dropping this would have UN-HIDDEN
--        every held or removed post to all 56 members — turning a security
--        tightening into a content leak.
--   work_items                              house scoping
--   tournaments + entrants/matches/participants   private-activity membership (0150)
--   meetings / meeting_slots / meeting_availability
--        a CASE where ONLY the 'family' branch is "signed in"; the committee and
--        house branches already require real membership and are left untouched.
--
-- This is the 0160 lesson applied deliberately: never recreate a policy from an
-- assumption about what it contains.
--
-- NOT CHANGED, because they're already stricter than this:
--   committee_messages / house_messages and their media — gated on
--     can_access_committee_area() / is_house_member(), i.e. real membership. An
--     unverified stranger has neither, so chat is already closed to them. Those
--     functions have been recreated by 0063 -> 0128 -> 0160 -> 0172 and are exactly
--     where a careless rewrite has already caused one incident here.
--   events, cabins, announcements, committees, resort_config, app_images,
--     fest_content — public by design (browse-first content, no PII).

-- ⚠️⚠️ WRAPPED IN A TRANSACTION, AND IT MUST STAY THAT WAY.
--
-- Every change below is DROP POLICY then CREATE POLICY. If any CREATE failed
-- partway through — a typo, a renamed helper function, a permissions problem — the
-- tables already processed would be left with NO read policy at all. RLS denies by
-- default, so that isn't a failed migration, it's an outage: the whole family's
-- posts and photos would vanish until someone noticed and fixed it by hand.
-- BEGIN/COMMIT makes it all-or-nothing.
--
-- (Verified before writing this: is_approved_member(), is_house_member(uuid),
-- can_access_committee_area(uuid,text) and is_private_activity_member(uuid) all
-- exist with these exact signatures.)
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles — the ONE that needs an own-row exception.
--
-- ⚠️ Without `id = auth.uid()` an unverified member cannot read their OWN profile
-- row, which breaks identity loading and leaves them unable to be shown a "waiting
-- to be verified" state at all. Guests already fall back to the masked
-- `public_profiles` view for other people's names, and an unverified member now
-- does the same — which is the intent.
--
-- No recursion risk: is_approved_member() is SECURITY DEFINER and so bypasses RLS
-- on profiles rather than re-entering this policy.
drop policy if exists "profiles: member read" on public.profiles;
create policy "profiles: member read"
  on public.profiles for select
  using (is_approved_member() or id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Simple swaps — these were exactly `(auth.uid() IS NOT NULL)` and nothing more.
drop policy if exists "albums: member read" on public.albums;
create policy "albums: member read" on public.albums for select using (is_approved_member());

drop policy if exists "committee_roster member read" on public.committee_roster;
create policy "committee_roster member read" on public.committee_roster for select using (is_approved_member());

drop policy if exists "family_roster read" on public.family_roster;
create policy "family_roster read" on public.family_roster for select using (is_approved_member());

drop policy if exists "houses: member read" on public.houses;
create policy "houses: member read" on public.houses for select using (is_approved_member());

drop policy if exists "event_attendance: member read" on public.event_attendance;
create policy "event_attendance: member read" on public.event_attendance for select using (is_approved_member());

drop policy if exists "help_requests: members read" on public.help_requests;
create policy "help_requests: members read" on public.help_requests for select using (is_approved_member());

drop policy if exists "help_responses: members read" on public.help_responses;
create policy "help_responses: members read" on public.help_responses for select using (is_approved_member());

drop policy if exists "help_request_items: members read" on public.help_request_items;
create policy "help_request_items: members read" on public.help_request_items for select using (is_approved_member());

drop policy if exists "polls: member read" on public.polls;
create policy "polls: member read" on public.polls for select using (is_approved_member());

drop policy if exists "poll_options: member read" on public.poll_options;
create policy "poll_options: member read" on public.poll_options for select using (is_approved_member());

drop policy if exists "poll_votes: member read" on public.poll_votes;
create policy "poll_votes: member read" on public.poll_votes for select using (is_approved_member());

drop policy if exists "media: member read" on public.post_media;
create policy "media: member read" on public.post_media for select using (is_approved_member());

drop policy if exists "comment media: member read" on public.post_comment_media;
create policy "comment media: member read" on public.post_comment_media for select using (is_approved_member());

drop policy if exists "comment mentions: member read" on public.post_comment_mentions;
create policy "comment mentions: member read" on public.post_comment_mentions for select using (is_approved_member());

drop policy if exists "reactions: member read" on public.post_reactions;
create policy "reactions: member read" on public.post_reactions for select using (is_approved_member());

drop policy if exists "tags: member read" on public.post_tags;
create policy "tags: member read" on public.post_tags for select using (is_approved_member());

drop policy if exists "drop_boxes_read" on public.drop_boxes;
create policy "drop_boxes_read" on public.drop_boxes for select using (is_approved_member());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Compound — the extra condition is preserved EXACTLY as pg_policies reported it.

-- Moderation-status-aware. The second half is what keeps held/removed content
-- hidden; only the first term changes.
drop policy if exists "posts: member read" on public.posts;
create policy "posts: member read"
  on public.posts for select
  using (
    is_approved_member()
    and (
      status = 'visible'
      or author_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

drop policy if exists "comments: member read" on public.post_comments;
create policy "comments: member read"
  on public.post_comments for select
  using (
    is_approved_member()
    and (
      status = 'visible'
      or author_id = auth.uid()
      or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
    )
  );

drop policy if exists "drop_box_media_read" on public.drop_box_media;
create policy "drop_box_media_read"
  on public.drop_box_media for select
  using (
    is_approved_member()
    and (
      status = 'visible'
      or uploaded_by = auth.uid()
      or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.is_admin)
    )
  );

-- House scoping preserved.
drop policy if exists "work_items: member scoped read" on public.work_items;
create policy "work_items: member scoped read"
  on public.work_items for select
  using (is_approved_member() and (house_id is null or is_house_member(house_id)));

-- Private-activity membership preserved (0150).
drop policy if exists "tournaments: member read" on public.tournaments;
create policy "tournaments: member read"
  on public.tournaments for select
  using (
    is_approved_member()
    and (private_activity_id is null or is_private_activity_member(private_activity_id))
  );

drop policy if exists "tournament_entrants: member read" on public.tournament_entrants;
create policy "tournament_entrants: member read"
  on public.tournament_entrants for select
  using (
    is_approved_member()
    and exists (
      select 1 from tournaments t
       where t.id = tournament_entrants.tournament_id
         and (t.private_activity_id is null or is_private_activity_member(t.private_activity_id))
    )
  );

drop policy if exists "tournament_matches: member read" on public.tournament_matches;
create policy "tournament_matches: member read"
  on public.tournament_matches for select
  using (
    is_approved_member()
    and exists (
      select 1 from tournaments t
       where t.id = tournament_matches.tournament_id
         and (t.private_activity_id is null or is_private_activity_member(t.private_activity_id))
    )
  );

drop policy if exists "tournament_participants: member read" on public.tournament_participants;
create policy "tournament_participants: member read"
  on public.tournament_participants for select
  using (
    is_approved_member()
    and exists (
      select 1 from tournaments t
       where t.id = tournament_participants.tournament_id
         and (t.private_activity_id is null or is_private_activity_member(t.private_activity_id))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The meetings trio — ONLY the 'family' branch of the CASE changes. The
--    committee and house branches already demand real membership.
drop policy if exists "meetings: room read" on public.meetings;
create policy "meetings: room read"
  on public.meetings for select
  using (
    case
      when scope_type = 'committee' then can_access_committee_area(committee_id, area)
      when scope_type = 'house' then is_house_member(house_id)
      when scope_type = 'family' then is_approved_member()
      else false
    end
  );

drop policy if exists "meeting_slots: room read" on public.meeting_slots;
create policy "meeting_slots: room read"
  on public.meeting_slots for select
  using (
    exists (
      select 1 from meetings m
       where m.id = meeting_slots.meeting_id
         and case
           when m.scope_type = 'committee' then can_access_committee_area(m.committee_id, m.area)
           when m.scope_type = 'house' then is_house_member(m.house_id)
           when m.scope_type = 'family' then is_approved_member()
           else false
         end
    )
  );

drop policy if exists "meeting_availability: room read" on public.meeting_availability;
create policy "meeting_availability: room read"
  on public.meeting_availability for select
  using (
    exists (
      select 1 from meetings m
       where m.id = meeting_availability.meeting_id
         and case
           when m.scope_type = 'committee' then can_access_committee_area(m.committee_id, m.area)
           when m.scope_type = 'house' then is_house_member(m.house_id)
           when m.scope_type = 'family' then is_approved_member()
           else false
         end
    )
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verify. Run this AFTER the commit above.
--
-- Expect ZERO rows: every members-only read now goes through is_approved_member().
-- (profiles keeps `id = auth.uid()` as its own-row escape hatch, which doesn't
-- match this pattern.) Anything listed here was missed and is still readable by any
-- signed-in account.
select tablename, policyname, qual
  from pg_policies
 where schemaname = 'public'
   and qual like '%auth.uid() IS NOT NULL%'
 order by tablename;

-- And confirm the new predicate is actually in place on the big ones:
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and qual like '%is_approved_member%'
 order by tablename;
