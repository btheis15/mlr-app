-- 0068_work_item_comments.sql
-- Comment threads on work items, so a task can hold a little Q&A: whoever posted
-- "sweep off the roof" can ask a question and anyone who can see the item can
-- reply to help sort it out. Plain text + @mentions only (no reactions/media).
-- Mirrors post comments (0003/0022) but scoped: a comment follows its parent work
-- item's visibility — MLR items (house_id null) are public-read, house items are
-- members-only (0066). Apply after 0067.

-- ── Comments ─────────────────────────────────────────────────────────────────
create table if not exists public.work_item_comments (
  id           uuid        primary key default gen_random_uuid(),
  work_item_id uuid        not null references public.work_items (id) on delete cascade,
  author_id    uuid        not null references public.profiles (id) on delete cascade,
  text         text        not null check (char_length(btrim(text)) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index if not exists work_item_comments_item_idx on public.work_item_comments (work_item_id, created_at);
alter table public.work_item_comments enable row level security;

-- Read/insert follow the PARENT item's visibility (unlike public post comments).
drop policy if exists "wicomments: scoped read" on public.work_item_comments;
create policy "wicomments: scoped read" on public.work_item_comments for select
  using (exists (
    select 1 from public.work_items w
    where w.id = work_item_id
      and (w.house_id is null or public.is_house_member(w.house_id))
  ));

drop policy if exists "wicomments: insert own scoped" on public.work_item_comments;
create policy "wicomments: insert own scoped" on public.work_item_comments for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.work_items w
      where w.id = work_item_id
        and (w.house_id is null or public.is_house_member(w.house_id))
    )
  );

drop policy if exists "wicomments: delete own or admin" on public.work_item_comments;
create policy "wicomments: delete own or admin" on public.work_item_comments for delete
  using (
    author_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ── Mentions ─────────────────────────────────────────────────────────────────
create table if not exists public.work_item_comment_mentions (
  comment_id        uuid not null references public.work_item_comments (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (comment_id, mentioned_user_id)
);
alter table public.work_item_comment_mentions enable row level security;

drop policy if exists "wimention: scoped read" on public.work_item_comment_mentions;
create policy "wimention: scoped read" on public.work_item_comment_mentions for select
  using (exists (
    select 1 from public.work_item_comments c
    join public.work_items w on w.id = c.work_item_id
    where c.id = comment_id
      and (w.house_id is null or public.is_house_member(w.house_id))
  ));

-- You can only mention someone on YOUR OWN comment, and only someone who can see
-- the item: for a house item that means a member of that house (or an admin);
-- MLR items are public so anyone is mentionable. Mirrors 0024 for committees.
drop policy if exists "wimention: insert on own comment" on public.work_item_comment_mentions;
create policy "wimention: insert on own comment" on public.work_item_comment_mentions for insert
  with check (exists (
    select 1 from public.work_item_comments c
    join public.work_items w on w.id = c.work_item_id
    where c.id = comment_id
      and c.author_id = auth.uid()
      and (
        w.house_id is null
        or exists (
          select 1 from public.profiles mp
          where mp.id = mentioned_user_id and (mp.house_id = w.house_id or mp.is_admin)
        )
      )
  ));

drop policy if exists "wimention: delete own or admin" on public.work_item_comment_mentions;
create policy "wimention: delete own or admin" on public.work_item_comment_mentions for delete
  using (exists (
    select 1 from public.work_item_comments c
    where c.id = comment_id
      and (c.author_id = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ));

-- ── Notifications ────────────────────────────────────────────────────────────
-- Two new kinds ride the existing Activity feed via _notify (0030), gated by the
-- recipient's notif_types. New comment → notify the item's creator + everyone who
-- already commented; @mention → notify the mentioned member. Deep-links to Home
-- with ?work=<id> (the checklist opens that item's thread).
create or replace function public.notif_on_work_item_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid;
  v_title   text;
  v_actor   text;
  v_snippet text;
  v_url     text;
begin
  select created_by, left(coalesce(title, 'a work item'), 80)
    into v_creator, v_title
    from public.work_items where id = NEW.work_item_id;
  select coalesce(display_name, 'Someone') into v_actor
    from public.profiles where id = NEW.author_id;
  v_snippet := left(coalesce(NEW.text, ''), 140);
  v_url := '/?work=' || NEW.work_item_id;

  if v_creator is not null and v_creator <> NEW.author_id then
    perform public._notify(
      v_creator, 'work_item_comment', NEW.author_id,
      v_actor || ' commented on "' || v_title || '"', v_snippet, v_url,
      'work_item', NEW.work_item_id, null);
  end if;

  perform public._notify(
    c.author_id, 'work_item_comment', NEW.author_id,
    v_actor || ' also commented on "' || v_title || '"', v_snippet, v_url,
    'work_item', NEW.work_item_id, null)
  from (
    select distinct wc.author_id
    from public.work_item_comments wc
    where wc.work_item_id = NEW.work_item_id
      and wc.author_id <> NEW.author_id
      and wc.author_id is distinct from v_creator
  ) c;

  return NEW;
end;
$$;
drop trigger if exists trg_notif_work_item_comment on public.work_item_comments;
create trigger trg_notif_work_item_comment after insert on public.work_item_comments
  for each row execute function public.notif_on_work_item_comment();

create or replace function public.notif_on_work_item_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment_author uuid;
  v_work_item      uuid;
  v_title          text;
  v_actor          text;
  v_snippet        text;
begin
  select c.author_id, c.work_item_id, left(coalesce(c.text, ''), 140)
    into v_comment_author, v_work_item, v_snippet
    from public.work_item_comments c where c.id = NEW.comment_id;
  select left(coalesce(title, 'a work item'), 80) into v_title
    from public.work_items where id = v_work_item;
  select coalesce(display_name, 'Someone') into v_actor
    from public.profiles where id = v_comment_author;
  perform public._notify(
    NEW.mentioned_user_id, 'work_item_mention', v_comment_author,
    v_actor || ' mentioned you on "' || v_title || '"', v_snippet,
    '/?work=' || v_work_item, 'work_item', v_work_item, null);
  return NEW;
end;
$$;
drop trigger if exists trg_notif_work_item_mention on public.work_item_comment_mentions;
create trigger trg_notif_work_item_mention after insert on public.work_item_comment_mentions
  for each row execute function public.notif_on_work_item_mention();

-- ── notif_types: register the two new kinds (default on) ──────────────────────
alter table public.profiles alter column notif_types set default
  '{post_comment,post_reply,post_mention,post_tag,post_reaction,new_post,chat_mention,committee_join,committee_join_request,cabin_request,cabin_decision,event_rsvp,help_request,help_response,help_urgent,work_item_comment,work_item_mention}';

update public.profiles set notif_types = array_append(notif_types, 'work_item_comment')
  where not ('work_item_comment' = any(notif_types));
update public.profiles set notif_types = array_append(notif_types, 'work_item_mention')
  where not ('work_item_mention' = any(notif_types));

-- ── Realtime ─────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table public.work_item_comments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.work_item_comment_mentions; exception when duplicate_object then null; end $$;
