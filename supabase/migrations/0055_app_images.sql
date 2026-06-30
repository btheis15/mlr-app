-- App-managed images (the Home logo, the Family Fest cover, …) so admins /
-- Family Fest committee can swap key site images in-app instead of shipping a
-- new build. Both the web app and iOS read the URL and fall back to the bundled
-- asset when it's unset/unreachable. Reads are public; writes gated to
-- can_edit_fest() (added in migration 0053). One row per image, keyed by a
-- stable slug (e.g. 'home_logo', 'fest_cover').

create table if not exists public.app_images (
  key        text primary key,
  url        text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.app_images enable row level security;

drop policy if exists "app_images read" on public.app_images;
create policy "app_images read" on public.app_images for select using (true);

drop policy if exists "app_images write" on public.app_images;
create policy "app_images write" on public.app_images for all
  using (public.can_edit_fest()) with check (public.can_edit_fest());

-- ── Storage: a public bucket for these site images ────────────────────────────
insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

-- Anyone may read; only fest editors (admins / family-fest committee) may write.
drop policy if exists "site-assets read" on storage.objects;
create policy "site-assets read" on storage.objects for select
  using (bucket_id = 'site-assets');

drop policy if exists "site-assets write" on storage.objects;
create policy "site-assets write" on storage.objects for all
  using (bucket_id = 'site-assets' and public.can_edit_fest())
  with check (bucket_id = 'site-assets' and public.can_edit_fest());
