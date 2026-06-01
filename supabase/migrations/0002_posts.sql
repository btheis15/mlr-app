-- 0002_posts.sql
-- The shared Posts feed: photos + notes everyone sees, across every device
-- (NEXT-STEPS §3d). Public read so anyone with the link can browse; only
-- signed-in members can post; author or an admin can delete.
--
-- Apply: paste into the Supabase SQL editor and Run.

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  text text,
  image_path text,                       -- object path in the 'post-photos' bucket
  created_at timestamptz not null default now()
);
create index if not exists posts_created_at_idx on public.posts (created_at desc);

alter table public.posts enable row level security;

drop policy if exists "posts: public read" on public.posts;
create policy "posts: public read" on public.posts for select using (true);

drop policy if exists "posts: insert own" on public.posts;
create policy "posts: insert own" on public.posts for insert
  with check (auth.uid() = author_id);

drop policy if exists "posts: delete own or admin" on public.posts;
create policy "posts: delete own or admin" on public.posts for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- Live updates: let clients subscribe to new/removed posts.
do $$ begin
  alter publication supabase_realtime add table public.posts;
exception when duplicate_object then null;
end $$;

-- Photo storage: a public-read bucket for post images.
insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', true)
on conflict (id) do nothing;

drop policy if exists "post-photos: public read" on storage.objects;
create policy "post-photos: public read" on storage.objects for select
  using (bucket_id = 'post-photos');

drop policy if exists "post-photos: authed upload" on storage.objects;
create policy "post-photos: authed upload" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'post-photos');
