-- 0013_committee_chat.sql
-- Private per-committee chat. The whole point: a room only the committee's
-- approved members (and admins) can read or post in — enforced in the database
-- by RLS via is_committee_member() (0012), not just hidden in the UI.
--
-- What lives where (hybrid, same split as Posts): the messages themselves are
-- tiny TEXT rows in Supabase (free, and Realtime delivers them live); the heavy
-- bits — photos, videos, stickers, GIFs — are URLs to the Mac-mini media server
-- (or, for GIFs, a Tenor CDN URL). So Supabase only ever stores a little text +
-- some URLs, which stays comfortably inside the free tier.
--
-- Apply in the Supabase SQL editor after 0012.

-- ── Messages ─────────────────────────────────────────────────────────────────
create table if not exists public.committee_messages (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  text text,
  -- iOS-style inline reply: points at the message being replied to. on delete
  -- set null so deleting the original just drops the little quoted preview.
  reply_to_id uuid references public.committee_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists committee_messages_room_idx on public.committee_messages (committee_id, created_at);
alter table public.committee_messages enable row level security;

-- The security core: you can only read/post if you're a member of THIS committee.
drop policy if exists "cmsg: member read" on public.committee_messages;
create policy "cmsg: member read" on public.committee_messages for select
  using (public.is_committee_member(committee_id));

drop policy if exists "cmsg: member insert own" on public.committee_messages;
create policy "cmsg: member insert own" on public.committee_messages for insert
  with check (author_id = auth.uid() and public.is_committee_member(committee_id));

-- Author edits their own message; author or admin can delete.
drop policy if exists "cmsg: author update" on public.committee_messages;
create policy "cmsg: author update" on public.committee_messages for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "cmsg: author or admin delete" on public.committee_messages;
create policy "cmsg: author or admin delete" on public.committee_messages for delete
  using (
    author_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ── Attachments: photos, videos, stickers, GIFs ──────────────────────────────
-- storage_path holds a full URL: the Mac-mini media server for photos/videos/
-- stickers, or a Tenor CDN URL for GIFs (hotlinked → zero storage cost).
create table if not exists public.committee_message_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.committee_messages (id) on delete cascade,
  storage_path text not null,
  media_type text not null default 'image' check (media_type in ('image','video','sticker','gif')),
  width int,
  height int,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists committee_message_media_idx on public.committee_message_media (message_id, position);
alter table public.committee_message_media enable row level security;

drop policy if exists "cmedia: member read" on public.committee_message_media;
create policy "cmedia: member read" on public.committee_message_media for select
  using (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.is_committee_member(m.committee_id)
  ));
drop policy if exists "cmedia: insert on own message" on public.committee_message_media;
create policy "cmedia: insert on own message" on public.committee_message_media for insert
  with check (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and m.author_id = auth.uid()
  ));
drop policy if exists "cmedia: delete own or admin" on public.committee_message_media;
create policy "cmedia: delete own or admin" on public.committee_message_media for delete
  using (exists (
    select 1 from public.committee_messages m
    where m.id = message_id
      and (m.author_id = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ));

-- ── Reactions (iMessage-style tapback: one per member per message) ───────────
create table if not exists public.committee_message_reactions (
  message_id uuid not null references public.committee_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.committee_message_reactions enable row level security;

drop policy if exists "creact: member read" on public.committee_message_reactions;
create policy "creact: member read" on public.committee_message_reactions for select
  using (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.is_committee_member(m.committee_id)
  ));
drop policy if exists "creact: insert own" on public.committee_message_reactions;
create policy "creact: insert own" on public.committee_message_reactions for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.is_committee_member(m.committee_id)
  ));
drop policy if exists "creact: update own" on public.committee_message_reactions;
create policy "creact: update own" on public.committee_message_reactions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "creact: delete own" on public.committee_message_reactions;
create policy "creact: delete own" on public.committee_message_reactions for delete
  using (user_id = auth.uid());

-- ── Mentions (@someone) ──────────────────────────────────────────────────────
create table if not exists public.committee_message_mentions (
  message_id uuid not null references public.committee_messages (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);
alter table public.committee_message_mentions enable row level security;

drop policy if exists "cmention: member read" on public.committee_message_mentions;
create policy "cmention: member read" on public.committee_message_mentions for select
  using (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and public.is_committee_member(m.committee_id)
  ));
drop policy if exists "cmention: insert on own message" on public.committee_message_mentions;
create policy "cmention: insert on own message" on public.committee_message_mentions for insert
  with check (exists (
    select 1 from public.committee_messages m
    where m.id = message_id and m.author_id = auth.uid()
  ));

-- Live updates for every chat table.
do $$ begin alter publication supabase_realtime add table public.committee_messages; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.committee_message_media; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.committee_message_reactions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.committee_message_mentions; exception when duplicate_object then null; end $$;
