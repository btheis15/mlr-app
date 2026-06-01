-- 0001_profiles.sql
-- The "one shared identity" foundation (NEXT-STEPS §3, §3b-2): a single
-- `profiles` row per auth user, keyed by auth.users.id. People are shown
-- everywhere by display_name + avatar — never by email or legal name.
--
-- Apply: paste into the Supabase SQL editor and Run (or `supabase db push`).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  full_name text,                                   -- optional, private
  household text,
  bio text,
  email_alerts boolean not null default true,
  is_admin boolean not null default false,
  include_in_directory boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Public browse: anyone (even signed-out) can read profiles so the UI can
-- render names/avatars. Per-field privacy comes later (app-side + columns).
drop policy if exists "profiles: public read" on public.profiles;
create policy "profiles: public read"
  on public.profiles for select
  using (true);

-- A user may create and edit only their own row.
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- Block privilege escalation: clients may update only these columns, NEVER
-- is_admin. Admins are set from the SQL editor / a secret key, not the client
-- (this is the point of moving admin off the client allow-list, NEXT-STEPS §3b).
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, full_name, household, bio, email_alerts, include_in_directory)
  on public.profiles to authenticated;

-- Auto-create a profile when someone signs up. Default display_name = a passed
-- display_name, else the part of their email before the "@".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh on edits.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
