-- 0164_comment_notification_deep_link.sql
-- Tapping a post_comment / post_reply / post_mention notification landed on
-- the POST, not the specific comment — same "deep link doesn't land where it
-- should" problem already fixed for tapped push notifications in general
-- (PushDeepLink.tsx), but this one is a URL-content gap, not a routing gap:
-- notif_on_post_comment()/notif_on_post_mention() never included WHICH comment
-- the notification was about, only the post. So the recipient always had to
-- scroll the whole comment thread by hand to find it — exactly the original
-- "hunt for it yourself" complaint, just for comments instead of posts.
--
-- Fix: append `&comment=<comment id>` to the url these two triggers build.
-- PostsView.tsx reads it with a second, independent useDeepLinkFlash instance
-- (idPrefix "comment-", alongside the existing "post-" one) and scrolls to +
-- flashes that specific comment once it's in the DOM.
--
-- Both functions recreated from their CURRENT (0030, still their only
-- definition — verified via grep across every migration) body VERBATIM, with
-- only the url line changed. See 0160's header for what happens when a
-- trigger function is instead rebuilt from a stale/incomplete copy.
--
-- Idempotent. Only affects notifications created AFTER this runs — existing
-- rows keep their post-only url (a harmless, unchanged degrade: it still opens
-- the right post, just without the extra scroll-to-comment).

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
  select author_id into v_post_author from public.posts where id = NEW.post_id;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = NEW.author_id;
  v_snippet := left(coalesce(NEW.text, ''), 140);
  v_url := '/posts?post=' || NEW.post_id || '&comment=' || NEW.id;

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
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = v_comment_author;
  perform public._notify(
    NEW.mentioned_user_id, 'post_mention', v_comment_author,
    v_actor_name || ' mentioned you in a comment', v_snippet,
    '/posts?post=' || v_post_id || '&comment=' || NEW.comment_id, 'post', v_post_id, null);
  return NEW;
end;
$$;
