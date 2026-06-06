-- 0024_committee_mention_scoping.sql
-- Harden committee-chat @mention scoping at the DB level.
--
-- Mention *scoping* in committee chat was UI-only: the @autocomplete only offers
-- that committee's roster, but a user who typed "@Name " by hand could still
-- POST a committee_message_mentions row pointing at a non-member. It can't leak
-- the room's contents (the read policy still gates that) — it would only attach a
-- stray highlight — so this is the low-urgency follow-up noted in HANDOFF.md.
--
-- This tightens the INSERT policy so you can only mention someone who is actually
-- a member of (or an admin in) the committee the message belongs to — matching
-- what the autocomplete already enforces, and mirroring is_committee_member's
-- member-OR-admin semantics, but evaluated for the *mentioned* user.
--
-- (post_comment_mentions needs no equivalent: posts/comments are public-read, so
-- there's no private roster to scope a comment mention to.)
--
-- Apply in the Supabase SQL editor after 0013 (which defines the table and the
-- original policy). Order-independent of the PR #106 migrations (0022/0023).

drop policy if exists "cmention: insert on own message" on public.committee_message_mentions;
create policy "cmention: insert on own message" on public.committee_message_mentions for insert
  with check (exists (
    select 1 from public.committee_messages m
    where m.id = message_id
      and m.author_id = auth.uid()
      and (
        exists (
          select 1 from public.committee_members cm
          where cm.committee_id = m.committee_id and cm.user_id = mentioned_user_id
        )
        or exists (
          select 1 from public.profiles p
          where p.id = mentioned_user_id and p.is_admin
        )
      )
  ));
