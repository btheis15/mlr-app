-- 0030_notifications_feed.sql
-- The in-app Notifications tab: a durable, per-recipient feed of events that
-- apply to YOU (Facebook-style). Fan-out-on-write — one row per recipient,
-- created by SECURITY DEFINER triggers on the source tables. The feed is
-- independent of the Mac-mini push-sender: it keeps working even if the mini is
-- down, and it deliberately EXCLUDES the chat firehose (only chat @mentions land
-- here), unlike push.
--
-- Read model (two levels, like Facebook):
--   • seen_at — drives the tab BADGE. Opening the tab marks all unseen as seen.
--   • read_at — drives per-item bold/highlight. Set when you tap an item.
--   • expires_at — an expired-but-unseen item stops counting toward the badge but
--     still shows in the list. Mainly used by admin broadcasts.
--
-- Recipients' prefs (profiles.notif_types, 0029) gate the event triggers, EXCEPT
-- admin broadcasts which always deliver (audience is the gate).
--
-- Apply in the Supabase SQL editor after 0029.

-- ── The feed ─────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type         text not null,        -- post_comment | post_reply | post_mention |
                                      -- post_tag | post_reaction | new_post |
                                      -- chat_mention | committee_join | broadcast
  actor_id     uuid references public.profiles (id) on delete set null,
  title        text not null,        -- denormalized, e.g. "Jane commented on your post"
  body         text,                 -- snippet / preview
  url          text,                 -- deep-link target inside the app
  entity_type  text,                 -- 'post' | 'committee_message' | 'committee' | 'broadcast'
  entity_id    uuid,                 -- the source row, for click-through / dedup
  created_at   timestamptz not null default now(),
  seen_at      timestamptz,
  read_at      timestamptz,
  expires_at   timestamptz
);
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unseen_idx
  on public.notifications (recipient_id) where seen_at is null;

alter table public.notifications enable row level security;

-- You only ever see your own. There is NO client insert/update path — rows are
-- written only by the SECURITY DEFINER triggers/RPCs below (which bypass RLS).
-- seen/read state changes go through the mark_* RPCs, so members can't tamper
-- with a notification's type/title/etc.
drop policy if exists "notifications: own read" on public.notifications;
create policy "notifications: own read" on public.notifications for select
  using (recipient_id = auth.uid());

-- You may dismiss (delete) your own.
drop policy if exists "notifications: own delete" on public.notifications;
create policy "notifications: own delete" on public.notifications for delete
  using (recipient_id = auth.uid());

-- Live updates for the tab + badge.
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end $$;

-- ── Internal fan-out helper ──────────────────────────────────────────────────
-- Inserts one notification, but only if the recipient actually wants this type
-- (profiles.notif_types) and isn't the actor. Locked down: execute is revoked
-- from everyone, so only the SECURITY DEFINER triggers (running as owner) can
-- call it — never a client. Broadcasts insert directly (see the RPC), bypassing
-- the notif_types gate on purpose.
create or replace function public._notify(
  p_recipient uuid, p_type text, p_actor uuid, p_title text,
  p_body text default null, p_url text default null,
  p_entity_type text default null, p_entity_id uuid default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_recipient = p_actor then return; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_recipient and p_type = any(p.notif_types)
  ) then
    return;
  end if;
  insert into public.notifications
    (recipient_id, type, actor_id, title, body, url, entity_type, entity_id, expires_at)
  values
    (p_recipient, p_type, p_actor, p_title, p_body, p_url, p_entity_type, p_entity_id, p_expires_at);
end;
$$;
revoke all on function public._notify(uuid,text,uuid,text,text,text,text,uuid,timestamptz) from public, anon, authenticated;

-- ── Triggers: posts feed ─────────────────────────────────────────────────────
-- New comment → notify the post author ('post_comment') AND everyone else who
-- already commented on that post ('post_reply'). Mentions land separately below.
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
drop trigger if exists trg_notif_post_comment on public.post_comments;
create trigger trg_notif_post_comment after insert on public.post_comments
  for each row execute function public.notif_on_post_comment();

-- @mention inside a comment → notify the mentioned member.
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
    '/posts?post=' || v_post_id, 'post', v_post_id, null);
  return NEW;
end;
$$;
drop trigger if exists trg_notif_post_mention on public.post_comment_mentions;
create trigger trg_notif_post_mention after insert on public.post_comment_mentions
  for each row execute function public.notif_on_post_mention();

-- Tagged in a post → notify the tagged member (tags are inserted by the post author).
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
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = v_post_author;
  perform public._notify(
    NEW.tagged_user_id, 'post_tag', v_post_author,
    v_actor_name || ' tagged you in a post', null,
    '/posts?post=' || NEW.post_id, 'post', NEW.post_id, null);
  return NEW;
end;
$$;
drop trigger if exists trg_notif_post_tag on public.post_tags;
create trigger trg_notif_post_tag after insert on public.post_tags
  for each row execute function public.notif_on_post_tag();

-- Emoji reaction on your post → notify the post author.
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
drop trigger if exists trg_notif_post_reaction on public.post_reactions;
create trigger trg_notif_post_reaction after insert on public.post_reactions
  for each row execute function public.notif_on_post_reaction();

-- New post on the Feed → notify every member who wants 'new_post'.
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
drop trigger if exists trg_notif_new_post on public.posts;
create trigger trg_notif_new_post after insert on public.posts
  for each row execute function public.notif_on_new_post();

-- ── Triggers: committee chat + membership ────────────────────────────────────
-- @mention in a committee chat → notify the mentioned member.
create or replace function public.notif_on_chat_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg_author uuid;
  v_committee  uuid;
  v_slug       text;
  v_cname      text;
  v_actor_name text;
  v_snippet    text;
begin
  select cm.author_id, cm.committee_id, left(coalesce(cm.text, ''), 140)
    into v_msg_author, v_committee, v_snippet
    from public.committee_messages cm where cm.id = NEW.message_id;
  select c.slug, c.name into v_slug, v_cname from public.committees c where c.id = v_committee;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = v_msg_author;
  perform public._notify(
    NEW.mentioned_user_id, 'chat_mention', v_msg_author,
    v_actor_name || ' mentioned you in ' || coalesce(v_cname, 'committee') || ' chat', v_snippet,
    '/committees/' || coalesce(v_slug, '') || '/chat?m=' || NEW.message_id,
    'committee_message', NEW.message_id, null);
  return NEW;
end;
$$;
drop trigger if exists trg_notif_chat_mention on public.committee_message_mentions;
create trigger trg_notif_chat_mention after insert on public.committee_message_mentions
  for each row execute function public.notif_on_chat_mention();

-- Committee join request approved/declined → notify the requester.
create or replace function public.notif_on_join_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cname text;
  v_slug  text;
begin
  if OLD.status = 'pending' and NEW.status in ('approved', 'rejected') then
    select name, slug into v_cname, v_slug from public.committees where id = NEW.committee_id;
    perform public._notify(
      NEW.user_id, 'committee_join', NEW.reviewed_by,
      case when NEW.status = 'approved'
        then 'You were added to ' || coalesce(v_cname, 'a committee')
        else 'Your request to join ' || coalesce(v_cname, 'a committee') || ' wasn''t approved' end,
      null,
      case when NEW.status = 'approved' then '/committees/' || coalesce(v_slug, '') else '/committees' end,
      'committee', NEW.committee_id, null);
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_notif_join_review on public.committee_join_requests;
create trigger trg_notif_join_review after update on public.committee_join_requests
  for each row execute function public.notif_on_join_review();

-- ── Read-state RPCs (only write path for seen/read) ──────────────────────────
-- Opening the tab clears the badge.
create or replace function public.mark_notifications_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set seen_at = now()
   where recipient_id = auth.uid() and seen_at is null;
$$;
revoke all on function public.mark_notifications_seen() from public, anon;
grant execute on function public.mark_notifications_seen() to authenticated;

-- Tapping an item marks it read (and seen).
create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set read_at = coalesce(read_at, now()), seen_at = coalesce(seen_at, now())
   where id = p_id and recipient_id = auth.uid();
$$;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- "Mark all as read".
create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now(), seen_at = now()
   where recipient_id = auth.uid() and read_at is null;
$$;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ── Admin broadcast ──────────────────────────────────────────────────────────
-- Deliberately send a notification to an audience, bypassing notif_types.
-- audience ∈ {'everyone','beta','admins'}. 'beta' is the Beta Tester group from
-- 0029 — the way to dry-run notifications without spamming the whole resort.
-- Returns how many recipients it reached.
create or replace function public.send_broadcast_notification(
  p_title text,
  p_body text default null,
  p_url text default null,
  p_audience text default 'everyone',
  p_expires_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'A title is required';
  end if;
  if p_audience not in ('everyone', 'beta', 'admins') then
    raise exception 'Unknown audience';
  end if;

  insert into public.notifications
    (recipient_id, type, actor_id, title, body, url, entity_type, expires_at)
  select p.id, 'broadcast', auth.uid(), p_title, nullif(p_body, ''), nullif(p_url, ''),
         'broadcast', p_expires_at
  from public.profiles p
  where case p_audience
          when 'everyone' then true
          when 'beta'     then p.beta_tester
          when 'admins'   then p.is_admin
        end;

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.send_broadcast_notification(text, text, text, text, timestamptz) from public, anon;
grant execute on function public.send_broadcast_notification(text, text, text, text, timestamptz) to authenticated;
