-- 0004_social_media.sql
-- Mini social-app upgrade: multiple photos/videos per post, member tagging,
-- albums, and avatar storage. Public read; signed-in members write; author or
-- admin can delete. Run once in the Supabase SQL editor.

-- ── Multiple photos & videos per post ───────────────────────────────────────
create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_path text not null,
  media_type text not null default 'image' check (media_type in ('image','video')),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists post_media_post_idx on public.post_media (post_id, position);
alter table public.post_media enable row level security;

drop policy if exists "media: public read" on public.post_media;
create policy "media: public read" on public.post_media for select using (true);
drop policy if exists "media: insert on own post" on public.post_media;
create policy "media: insert on own post" on public.post_media for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists "media: delete own or admin" on public.post_media;
create policy "media: delete own or admin" on public.post_media for delete
  using (
    exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
    or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin)
  );

-- Migrate existing single images into post_media (idempotent).
insert into public.post_media (post_id, storage_path, media_type, position)
select p.id, p.image_path, 'image', 0 from public.posts p
where p.image_path is not null
  and not exists (select 1 from public.post_media m where m.post_id = p.id);

-- ── Tag members in a post ────────────────────────────────────────────────────
create table if not exists public.post_tags (
  post_id uuid not null references public.posts (id) on delete cascade,
  tagged_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, tagged_user_id)
);
alter table public.post_tags enable row level security;

drop policy if exists "tags: public read" on public.post_tags;
create policy "tags: public read" on public.post_tags for select using (true);
drop policy if exists "tags: insert on own post" on public.post_tags;
create policy "tags: insert on own post" on public.post_tags for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists "tags: delete by poster, taggee, or admin" on public.post_tags;
create policy "tags: delete by poster, taggee, or admin" on public.post_tags for delete
  using (
    tagged_user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
    or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin)
  );

-- ── Albums ──────────────────────────────────────────────────────────────────
create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.albums enable row level security;

drop policy if exists "albums: public read" on public.albums;
create policy "albums: public read" on public.albums for select using (true);
drop policy if exists "albums: insert own" on public.albums;
create policy "albums: insert own" on public.albums for insert with check (auth.uid() = created_by);
drop policy if exists "albums: delete own or admin" on public.albums;
create policy "albums: delete own or admin" on public.albums for delete
  using (auth.uid() = created_by or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin));

alter table public.posts add column if not exists album_id uuid references public.albums (id) on delete set null;

-- ── Avatars storage bucket (public read) ─────────────────────────────────────
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars: authed upload" on storage.objects;
create policy "avatars: authed upload" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
drop policy if exists "avatars: authed update" on storage.objects;
create policy "avatars: authed update" on storage.objects for update to authenticated using (bucket_id = 'avatars');

-- Live updates
do $$ begin alter publication supabase_realtime add table public.post_media; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.post_tags; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.albums; exception when duplicate_object then null; end $$;
