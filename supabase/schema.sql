-- ============================================================================
-- Muskellunge Lake Resort — Supabase schema (ONE project for BOTH apps)
-- ============================================================================
-- Run this in the Supabase dashboard → SQL Editor → New query → Run.
-- This is the single source of truth for the shared backend that mlr-app and
-- family-fest both point at (NEXT-STEPS.md §3). Re-running is safe (idempotent).
--
-- Slice 1 (this file): profiles + one-shared-identity + RLS, plus the core
-- data tables that back the existing views (messages / rsvps / photos /
-- announcements) so wiring them up later (§3d) is a drop-in. Committees and
-- member_emails (§5b/§5c) come in their own later phase.
-- ============================================================================

-- ── profiles — ONE row per person, keyed by the auth user id ────────────────
-- This is the "one shared identity": signing in to either app resolves to the
-- same row. People are shown everywhere by display_name + avatar.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  avatar_url text,
  full_name text,                       -- optional / private
  bio text,
  household text,
  email_alerts boolean not null default true,
  is_admin boolean not null default false,
  include_in_directory boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone (even signed-out) can read profiles — needed to render names/avatars
-- and the member directory. (Per-field privacy is a later refinement, §3b-2.)
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

-- A user may create and edit only their OWN profile row.
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile when a new auth user is confirmed, seeded from the
-- metadata captured at the OTP step (name + email_alerts). The client also
-- upserts as a backstop, so this is belt-and-suspenders.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, email_alerts)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'email_alerts')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Authoritative, non-spoofable admin check (use in policies below).
create or replace function public.is_admin()
returns boolean
language sql stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ── messages — MLR resort chat (§3d wires components/ChatView.tsx here) ──────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
drop policy if exists "messages_select_all" on public.messages;
create policy "messages_select_all" on public.messages for select using (true);
drop policy if exists "messages_insert_auth" on public.messages;
create policy "messages_insert_auth" on public.messages
  for insert with check (auth.uid() = author_id);
drop policy if exists "messages_delete_own_or_admin" on public.messages;
create policy "messages_delete_own_or_admin" on public.messages
  for delete using (auth.uid() = author_id or public.is_admin());

-- ── rsvps — Family Fest crew (§3d wires CrewView.tsx here) ──────────────────
create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  household text not null,
  headcount int not null default 1 check (headcount >= 0),
  status text not null default 'yes' check (status in ('yes', 'maybe', 'no')),
  bringing text,
  created_at timestamptz not null default now()
);
alter table public.rsvps enable row level security;
drop policy if exists "rsvps_select_all" on public.rsvps;
create policy "rsvps_select_all" on public.rsvps for select using (true);
drop policy if exists "rsvps_write_own" on public.rsvps;
create policy "rsvps_write_own" on public.rsvps
  for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- ── photos — shared album (§3d wires PhotosView.tsx + Storage here) ──────────
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,           -- object path in the 'photos' Storage bucket
  caption text,
  created_at timestamptz not null default now()
);
alter table public.photos enable row level security;
drop policy if exists "photos_select_all" on public.photos;
create policy "photos_select_all" on public.photos for select using (true);
drop policy if exists "photos_insert_auth" on public.photos;
create policy "photos_insert_auth" on public.photos
  for insert with check (auth.uid() = created_by);
drop policy if exists "photos_delete_own_or_admin" on public.photos;
create policy "photos_delete_own_or_admin" on public.photos
  for delete using (auth.uid() = created_by or public.is_admin());

-- ── announcements — admin alerts + Google-Drive feed both write here (§4/§5) ─
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'info' check (severity in ('info', 'alert')),
  title text not null,
  body text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "announcements_select_all" on public.announcements;
create policy "announcements_select_all" on public.announcements for select using (true);
-- Only admins may post/edit/remove announcements.
drop policy if exists "announcements_write_admin" on public.announcements;
create policy "announcements_write_admin" on public.announcements
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- Later phases (uncomment when you reach them):
--   §5b member_emails  — multiple verified emails per profile, group-mail flag
--   §5c committees      — committees / committee_members / committee_join_requests
-- Plus a 'photos' Storage bucket (Storage → New bucket → public read) for §3d.
-- ============================================================================
