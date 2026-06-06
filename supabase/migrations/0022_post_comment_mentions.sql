-- 0022_post_comment_mentions.sql
-- @mentions inside Posts-feed comments. Posts and their comments are public-read
-- (anyone with the link sees them), so mentions are public-read too — same shape
-- as committee_message_mentions (0013), minus the membership gate. You can only
-- attach a mention to YOUR OWN comment; cascades clean up when the comment goes.
-- Apply in the Supabase SQL editor after 0021.

create table if not exists public.post_comment_mentions (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, mentioned_user_id)
);
alter table public.post_comment_mentions enable row level security;

drop policy if exists "comment mentions: public read" on public.post_comment_mentions;
create policy "comment mentions: public read" on public.post_comment_mentions for select using (true);

drop policy if exists "comment mentions: insert on own comment" on public.post_comment_mentions;
create policy "comment mentions: insert on own comment" on public.post_comment_mentions for insert
  with check (exists (
    select 1 from public.post_comments c
    where c.id = comment_id and c.author_id = auth.uid()
  ));

drop policy if exists "comment mentions: delete own or admin" on public.post_comment_mentions;
create policy "comment mentions: delete own or admin" on public.post_comment_mentions for delete
  using (exists (
    select 1 from public.post_comments c
    where c.id = comment_id
      and (c.author_id = auth.uid()
           or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  ));

-- Live updates
do $$ begin alter publication supabase_realtime add table public.post_comment_mentions; exception when duplicate_object then null; end $$;
