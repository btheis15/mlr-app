-- 0014_committee_reads.sql
-- Per-member read state, so the app can show an unread badge on a committee
-- (count of messages newer than your last_read_at, ignoring your own). Each
-- member only ever reads/writes their OWN row. Apply after 0013.

create table if not exists public.committee_reads (
  committee_id uuid not null references public.committees (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (committee_id, user_id)
);
alter table public.committee_reads enable row level security;

drop policy if exists "creads: own read" on public.committee_reads;
create policy "creads: own read" on public.committee_reads for select
  using (user_id = auth.uid());
drop policy if exists "creads: own insert" on public.committee_reads;
create policy "creads: own insert" on public.committee_reads for insert
  with check (user_id = auth.uid());
drop policy if exists "creads: own update" on public.committee_reads;
create policy "creads: own update" on public.committee_reads for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
