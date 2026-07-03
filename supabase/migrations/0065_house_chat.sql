-- 0065_house_chat.sql
-- Private per-house chat — a room only that house's members (and admins) can read
-- or post in, enforced in the database by RLS via is_house_member() (0064), not
-- just hidden in the UI. Full feature parity with committee chat (0013/0023/0024/
-- 0014): text messages, photo/video/sticker/gif attachments, tapback reactions,
-- @mentions, inline replies, 24h author edit/soft-delete, and per-member read
-- state for the unread badge.
--
-- Unlike committee chat (0063 area channels), a house is a SINGLE room — there is
-- no `area` column. Same hybrid storage split as Posts/committee chat: tiny TEXT
-- rows here, heavy media as URLs to the Mac-mini media server (or a Tenor CDN URL
-- for GIFs). Apply in the Supabase SQL editor after 0064.

-- ── Messages ─────────────────────────────────────────────────────────────────
create table if not exists public.house_messages (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.houses (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  text text,
  reply_to_id uuid references public.house_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz   -- soft-delete tombstone (see the update policy below)
);
create index if not exists house_messages_room_idx on public.house_messages (house_id, created_at);
alter table public.house_messages enable row level security;

-- The security core: you can only read/post if you're a member of THIS house.
drop policy if exists "hmsg: member read" on public.house_messages;
create policy "hmsg: member read" on public.house_messages for select
  using (public.is_house_member(house_id));

drop policy if exists "hmsg: member insert own" on public.house_messages;
create policy "hmsg: member insert own" on public.house_messages for insert
  with check (author_id = auth.uid() and public.is_house_member(house_id));

-- Author edits/soft-deletes their own message within 24h; admin anytime.
drop policy if exists "hmsg: author edit/delete 24h or admin" on public.house_messages;
create policy "hmsg: author edit/delete 24h or admin" on public.house_messages for update
  using (
    (author_id = auth.uid() and created_at > now() - interval '24 hours')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    (author_id = auth.uid() and created_at > now() - interval '24 hours')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Hard delete is admin-only (the app uses soft delete; this is a moderation
-- escape hatch so a client can never hard-delete around the tombstone).
drop policy if exists "hmsg: admin hard delete" on public.house_messages;
create policy "hmsg: admin hard delete" on public.house_messages for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── Attachments: photos, videos, stickers, GIFs ──────────────────────────────
create table if not exists public.house_message_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.house_messages (id) on delete cascade,
  storage_path text not null,   -- full URL (Mac-mini for media, Tenor CDN for GIFs)
  media_type text not null default 'image' check (media_type in ('image','video','sticker','gif')),
  width int,
  height int,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists house_message_media_idx on public.house_message_media (message_id, position);
alter table public.house_message_media enable row level security;

drop policy if exists "hmedia: member read" on public.house_message_media;
create policy "hmedia: member read" on public.house_message_media for select
  using (exists (
    select 1 from public.house_messages m
    where m.id = message_id and public.is_house_member(m.house_id)
  ));
drop policy if exists "hmedia: insert on own message" on public.house_message_media;
create policy "hmedia: insert on own message" on public.house_message_media for insert
  with check (exists (
    select 1 from public.house_messages m
    where m.id = message_id and m.author_id = auth.uid()
  ));
drop policy if exists "hmedia: delete own or admin" on public.house_message_media;
create policy "hmedia: delete own or admin" on public.house_message_media for delete
  using (exists (
    select 1 from public.house_messages m
    where m.id = message_id
      and (m.author_id = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ));

-- ── Reactions (iMessage-style tapback: one per member per message) ───────────
create table if not exists public.house_message_reactions (
  message_id uuid not null references public.house_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.house_message_reactions enable row level security;

drop policy if exists "hreact: member read" on public.house_message_reactions;
create policy "hreact: member read" on public.house_message_reactions for select
  using (exists (
    select 1 from public.house_messages m
    where m.id = message_id and public.is_house_member(m.house_id)
  ));
drop policy if exists "hreact: insert own" on public.house_message_reactions;
create policy "hreact: insert own" on public.house_message_reactions for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.house_messages m
    where m.id = message_id and public.is_house_member(m.house_id)
  ));
drop policy if exists "hreact: update own" on public.house_message_reactions;
create policy "hreact: update own" on public.house_message_reactions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "hreact: delete own" on public.house_message_reactions;
create policy "hreact: delete own" on public.house_message_reactions for delete
  using (user_id = auth.uid());

-- ── Mentions (@someone) ──────────────────────────────────────────────────────
create table if not exists public.house_message_mentions (
  message_id uuid not null references public.house_messages (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);
alter table public.house_message_mentions enable row level security;

drop policy if exists "hmention: member read" on public.house_message_mentions;
create policy "hmention: member read" on public.house_message_mentions for select
  using (exists (
    select 1 from public.house_messages m
    where m.id = message_id and public.is_house_member(m.house_id)
  ));
-- Scope who you can mention to the house's own members (or an admin), matching
-- what the autocomplete offers — mirrors 0024 for committees.
drop policy if exists "hmention: insert on own message" on public.house_message_mentions;
create policy "hmention: insert on own message" on public.house_message_mentions for insert
  with check (exists (
    select 1 from public.house_messages m
    where m.id = message_id
      and m.author_id = auth.uid()
      and (
        exists (
          select 1 from public.profiles mem
          where mem.id = mentioned_user_id and mem.house_id = m.house_id
        )
        or exists (
          select 1 from public.profiles p
          where p.id = mentioned_user_id and p.is_admin
        )
      )
  ));

-- ── Per-member read state (unread badge) ─────────────────────────────────────
create table if not exists public.house_reads (
  house_id uuid not null references public.houses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (house_id, user_id)
);
alter table public.house_reads enable row level security;

drop policy if exists "hreads: own read" on public.house_reads;
create policy "hreads: own read" on public.house_reads for select
  using (user_id = auth.uid());
drop policy if exists "hreads: own insert" on public.house_reads;
create policy "hreads: own insert" on public.house_reads for insert
  with check (user_id = auth.uid());
drop policy if exists "hreads: own update" on public.house_reads;
create policy "hreads: own update" on public.house_reads for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mark the house chat read (upsert my last_read_at). Mirror of mark_area_read (0063).
create or replace function public.mark_house_read(hid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.house_reads (house_id, user_id, last_read_at)
  values (hid, auth.uid(), now())
  on conflict (house_id, user_id)
  do update set last_read_at = now();
$$;
revoke all on function public.mark_house_read(uuid) from public, anon;
grant execute on function public.mark_house_read(uuid) to authenticated;

-- ── Mention → notification ───────────────────────────────────────────────────
-- Reuses the existing 'chat_mention' kind (0030) so it rides the member's Activity
-- feed + notif prefs. Deep-links to the house channel in the Feed tab.
create or replace function public.notif_on_house_chat_mention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg_author uuid;
  v_house      uuid;
  v_slug       text;
  v_hname      text;
  v_actor_name text;
  v_snippet    text;
begin
  select hm.author_id, hm.house_id, left(coalesce(hm.text, ''), 140)
    into v_msg_author, v_house, v_snippet
    from public.house_messages hm where hm.id = NEW.message_id;
  select h.slug, h.name into v_slug, v_hname from public.houses h where h.id = v_house;
  select coalesce(display_name, 'Someone') into v_actor_name
    from public.profiles where id = v_msg_author;
  perform public._notify(
    NEW.mentioned_user_id, 'chat_mention', v_msg_author,
    v_actor_name || ' mentioned you in ' || coalesce(v_hname, 'house') || ' chat', v_snippet,
    '/posts?house=' || coalesce(v_slug, '') || '&m=' || NEW.message_id,
    'house_message', NEW.message_id, null);
  return NEW;
end;
$$;
drop trigger if exists trg_notif_house_chat_mention on public.house_message_mentions;
create trigger trg_notif_house_chat_mention after insert on public.house_message_mentions
  for each row execute function public.notif_on_house_chat_mention();

-- ── Realtime ─────────────────────────────────────────────────────────────────
do $$ begin alter publication supabase_realtime add table public.house_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.house_message_media; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.house_message_reactions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.house_message_mentions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.house_reads; exception when duplicate_object then null; end $$;
