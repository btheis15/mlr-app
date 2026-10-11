-- 0158_block_app_review_engagement.sql
-- The hidden Apple App Store reviewer account (appreview@muskellungelakeresort.com,
-- see 0077/0085's new-member-notify exception) occasionally signs in and leaves
-- likes/comments/reactions/chat messages behind during app review passes — noise
-- that shouldn't sit in front of the family. This:
--   1. Purges every existing like/reaction/comment/post/chat message it has left,
--      soft-hiding anything with a moderation `status` column (posts, comments,
--      committee/house messages — same visible|pending|hidden model as 0040/0128,
--      so nothing is destroyed and an admin could restore via set_content_status)
--      and deleting rows with no status concept (reactions have no soft-hide idiom
--      anywhere in the app; removing a reaction IS deleting the row).
--   2. Installs AFTER INSERT triggers on every one of those tables so ANY future
--      row authored by that account is hidden/deleted immediately (within the
--      same transaction as the insert — effectively instant, not polled), rather
--      than a periodic sweep.
--
-- Idempotent. Apply in the Supabase SQL editor.

begin;

-- ── Helper: resolve the App Review profile id (may not exist locally) ────────
create or replace function public._app_review_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
  where lower(contact_email) = 'appreview@muskellungelakeresort.com'
  limit 1
$$;

-- ── 1. One-time purge of anything already left behind ────────────────────────
update public.posts set status = 'hidden'
  where author_id = public._app_review_profile_id() and status <> 'hidden';
update public.post_comments set status = 'hidden'
  where author_id = public._app_review_profile_id() and status <> 'hidden';
delete from public.post_reactions where user_id = public._app_review_profile_id();

update public.committee_messages set status = 'hidden'
  where author_id = public._app_review_profile_id() and status <> 'hidden';
delete from public.committee_message_reactions where user_id = public._app_review_profile_id();

update public.house_messages set status = 'hidden'
  where author_id = public._app_review_profile_id() and status <> 'hidden';
delete from public.house_message_reactions where user_id = public._app_review_profile_id();

-- ── 2. Instant-hide triggers so it can never happen again ────────────────────
create or replace function public._hide_app_review_status_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is not null and new.author_id = public._app_review_profile_id() then
    new.status := 'hidden';
  end if;
  return new;
end;
$$;

create or replace function public._delete_app_review_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id = public._app_review_profile_id() then
    delete from public.post_reactions where post_id = new.post_id and user_id = new.user_id;
    return null; -- suppress the insert
  end if;
  return new;
end;
$$;

create or replace function public._delete_app_review_committee_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id = public._app_review_profile_id() then
    delete from public.committee_message_reactions where message_id = new.message_id and user_id = new.user_id;
    return null;
  end if;
  return new;
end;
$$;

create or replace function public._delete_app_review_house_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id = public._app_review_profile_id() then
    delete from public.house_message_reactions where message_id = new.message_id and user_id = new.user_id;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists app_review_hide_post on public.posts;
create trigger app_review_hide_post
  before insert or update on public.posts
  for each row execute function public._hide_app_review_status_row();

drop trigger if exists app_review_hide_post_comment on public.post_comments;
create trigger app_review_hide_post_comment
  before insert or update on public.post_comments
  for each row execute function public._hide_app_review_status_row();

drop trigger if exists app_review_hide_committee_message on public.committee_messages;
create trigger app_review_hide_committee_message
  before insert or update on public.committee_messages
  for each row execute function public._hide_app_review_status_row();

drop trigger if exists app_review_hide_house_message on public.house_messages;
create trigger app_review_hide_house_message
  before insert or update on public.house_messages
  for each row execute function public._hide_app_review_status_row();

drop trigger if exists app_review_block_post_reaction on public.post_reactions;
create trigger app_review_block_post_reaction
  after insert on public.post_reactions
  for each row execute function public._delete_app_review_reaction();

drop trigger if exists app_review_block_committee_reaction on public.committee_message_reactions;
create trigger app_review_block_committee_reaction
  after insert on public.committee_message_reactions
  for each row execute function public._delete_app_review_committee_reaction();

drop trigger if exists app_review_block_house_reaction on public.house_message_reactions;
create trigger app_review_block_house_reaction
  after insert on public.house_message_reactions
  for each row execute function public._delete_app_review_house_reaction();

commit;
