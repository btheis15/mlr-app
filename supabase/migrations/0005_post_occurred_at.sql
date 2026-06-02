-- 0005_post_occurred_at.sql
-- Photo timeline + backdating. Posts now carry an `occurred_at` (when the
-- moment actually happened) separate from `created_at` (when it was uploaded).
-- The feed sorts/groups by `occurred_at`, so a photo posted late can be placed
-- back on the day (and time) it was taken and flow with the rest. Default is
-- now(), so posting "as usual" still lands today. Authors (and admins) can edit
-- it later, which needs a new UPDATE policy (none existed before).
--
-- Apply: paste into the Supabase SQL editor and Run. Until this runs, the app
-- falls back to created_at and the backdate controls stay hidden.

alter table public.posts
  add column if not exists occurred_at timestamptz not null default now();

-- Backfill existing rows so the timeline reflects when they were posted.
update public.posts set occurred_at = created_at where occurred_at is distinct from created_at and created_at is not null;

create index if not exists posts_occurred_at_idx on public.posts (occurred_at desc);

-- Editing a post's date/time: author or admin only.
drop policy if exists "posts: update own or admin" on public.posts;
create policy "posts: update own or admin" on public.posts for update
  using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  )
  with check (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
