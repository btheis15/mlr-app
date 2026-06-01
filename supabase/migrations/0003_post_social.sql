-- 0003_post_social.sql
-- Shared comments + emoji reactions for the Posts feed (NEXT-STEPS §3d).
-- Public read (anyone with the link sees them); only signed-in members write;
-- author or admin can delete. Apply in the Supabase SQL editor.

-- ── Comments ────────────────────────────────────────────────────────────────
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;

drop policy if exists "comments: public read" on public.post_comments;
create policy "comments: public read" on public.post_comments for select using (true);

drop policy if exists "comments: insert own" on public.post_comments;
create policy "comments: insert own" on public.post_comments for insert
  with check (auth.uid() = author_id);

drop policy if exists "comments: delete own or admin" on public.post_comments;
create policy "comments: delete own or admin" on public.post_comments for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ── Reactions: one emoji per member per post ─────────────────────────────────
create table if not exists public.post_reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_reactions enable row level security;

drop policy if exists "reactions: public read" on public.post_reactions;
create policy "reactions: public read" on public.post_reactions for select using (true);

drop policy if exists "reactions: insert own" on public.post_reactions;
create policy "reactions: insert own" on public.post_reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "reactions: update own" on public.post_reactions;
create policy "reactions: update own" on public.post_reactions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reactions: delete own" on public.post_reactions;
create policy "reactions: delete own" on public.post_reactions for delete
  using (auth.uid() = user_id);

-- Live updates
do $$ begin alter publication supabase_realtime add table public.post_comments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.post_reactions; exception when duplicate_object then null; end $$;
