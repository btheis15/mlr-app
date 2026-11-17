-- 0227_app_review_own_reactions.sql
-- 0158 deleted the review account's reactions the moment they were added, so
-- the reviewer tapped an emoji and nothing happened. 0226 now hides those rows
-- from everyone else (restrictive select policies) and drops the
-- notifications, so the reviewer can keep its own reactions.
begin;
drop trigger if exists app_review_block_post_reaction on public.post_reactions;
drop trigger if exists app_review_block_committee_reaction on public.committee_message_reactions;
drop trigger if exists app_review_block_house_reaction on public.house_message_reactions;
commit;
