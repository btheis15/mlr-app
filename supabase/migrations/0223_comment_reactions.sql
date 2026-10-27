-- 0223_comment_reactions.sql
-- Emoji reactions on Posts-feed comments (mirrors post_reactions, 0003/0183):
-- one emoji per member per comment; approved members read, own rows write.

create table if not exists public.comment_reactions (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_reactions enable row level security;

drop policy if exists "comment reactions: member read" on public.comment_reactions;
create policy "comment reactions: member read" on public.comment_reactions for select using (is_approved_member());

drop policy if exists "comment reactions: insert own" on public.comment_reactions;
create policy "comment reactions: insert own" on public.comment_reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "comment reactions: update own" on public.comment_reactions;
create policy "comment reactions: update own" on public.comment_reactions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "comment reactions: delete own" on public.comment_reactions;
create policy "comment reactions: delete own" on public.comment_reactions for delete
  using (auth.uid() = user_id);

do $$ begin alter publication supabase_realtime add table public.comment_reactions; exception when duplicate_object then null; end $$;
