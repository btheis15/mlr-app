-- 0159_app_review_no_notify.sql
-- 0158 hides/deletes App Review's likes/comments/posts instantly, but the
-- existing notification fan-out triggers (0030) fire independently on INSERT
-- and don't check moderation status — so a post/comment from that account
-- still notified everyone, and a reaction still notified the post author even
-- though a sibling AFTER-INSERT trigger deleted the reaction row a moment
-- later (Postgres runs same-event AFTER triggers in name order; deleting the
-- row in one trigger doesn't stop another already-queued trigger on the same
-- row from firing). This closes that gap: nobody is ever notified of
-- anything from the App Review account.
--
-- Idempotent. Apply after 0158.

begin;

-- new post → skip the 'new_post' broadcast entirely
create or replace function public.notif_on_new_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
  v_snippet    text;
begin
  if NEW.author_id = public._app_review_profile_id() then return NEW; end if;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = NEW.author_id;
  v_snippet := left(coalesce(NEW.text, ''), 140);
  perform public._notify(
    p.id, 'new_post', NEW.author_id,
    v_actor_name || ' shared a new post', v_snippet,
    '/posts?post=' || NEW.id, 'post', NEW.id, null)
  from public.profiles p
  where p.id <> NEW.author_id and 'new_post' = any(p.notif_types);
  return NEW;
end;
$$;

-- new comment → skip 'post_comment' / 'post_reply'
create or replace function public.notif_on_post_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_author uuid;
  v_actor_name  text;
  v_snippet     text;
  v_url         text;
begin
  if NEW.author_id = public._app_review_profile_id() then return NEW; end if;
  select author_id into v_post_author from public.posts where id = NEW.post_id;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = NEW.author_id;
  v_snippet := left(coalesce(NEW.text, ''), 140);
  v_url := '/posts?post=' || NEW.post_id;

  if v_post_author is not null and v_post_author <> NEW.author_id then
    perform public._notify(
      v_post_author, 'post_comment', NEW.author_id,
      v_actor_name || ' commented on your post', v_snippet, v_url, 'post', NEW.post_id, null);
  end if;

  perform public._notify(
    c.author_id, 'post_reply', NEW.author_id,
    v_actor_name || ' also commented on a post you''re on', v_snippet, v_url, 'post', NEW.post_id, null)
  from (
    select distinct pc.author_id
    from public.post_comments pc
    where pc.post_id = NEW.post_id
      and pc.author_id <> NEW.author_id
      and pc.author_id is distinct from v_post_author
  ) c;

  return NEW;
end;
$$;

-- @mention in a comment → skip 'post_mention'
create or replace function public.notif_on_post_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment_author uuid;
  v_post_id        uuid;
  v_snippet        text;
  v_actor_name     text;
begin
  select c.author_id, c.post_id, left(coalesce(c.text, ''), 140)
    into v_comment_author, v_post_id, v_snippet
    from public.post_comments c where c.id = NEW.comment_id;
  if v_comment_author = public._app_review_profile_id() then return NEW; end if;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = v_comment_author;
  perform public._notify(
    NEW.mentioned_user_id, 'post_mention', v_comment_author,
    v_actor_name || ' mentioned you in a comment', v_snippet,
    '/posts?post=' || v_post_id, 'post', v_post_id, null);
  return NEW;
end;
$$;

-- tagged in a post → skip 'post_tag'
create or replace function public.notif_on_post_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_author uuid;
  v_actor_name  text;
begin
  select author_id into v_post_author from public.posts where id = NEW.post_id;
  if v_post_author = public._app_review_profile_id() then return NEW; end if;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = v_post_author;
  perform public._notify(
    NEW.tagged_user_id, 'post_tag', v_post_author,
    v_actor_name || ' tagged you in a post', null,
    '/posts?post=' || NEW.post_id, 'post', NEW.post_id, null);
  return NEW;
end;
$$;

-- emoji reaction on a post → skip 'post_reaction'
create or replace function public.notif_on_post_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_author uuid;
  v_actor_name  text;
begin
  if NEW.user_id = public._app_review_profile_id() then return NEW; end if;
  select author_id into v_post_author from public.posts where id = NEW.post_id;
  if v_post_author is null or v_post_author = NEW.user_id then return NEW; end if;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = NEW.user_id;
  perform public._notify(
    v_post_author, 'post_reaction', NEW.user_id,
    v_actor_name || ' reacted ' || coalesce(NEW.emoji, '') || ' to your post', null,
    '/posts?post=' || NEW.post_id, 'post', NEW.post_id, null);
  return NEW;
end;
$$;

commit;
