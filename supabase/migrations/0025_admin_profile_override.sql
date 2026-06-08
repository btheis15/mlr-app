-- 0025_admin_profile_override.sql
-- Two-admin "break glass" for admin-initiated email changes.
--
-- Members change their own email in-app (no migration needed). But if someone
-- can't (“it's not working / I can't figure it out”), an admin can set it FOR
-- them — and because that rewrites another person's login, it's gated: it takes
-- TWO different admins to vote, which then UNLOCKS admin email-editing for 24h
-- for *any* admin. After the window it re-locks until two admins vote again.
--
-- This migration only holds the votes + unlock window. The actual email write
-- runs on the Mac mini with the service_role key (GoTrue admin API), and the
-- mini re-checks `is_override_unlocked()` before writing — the UI gate alone is
-- not trusted.
--
-- Apply: paste into the Supabase SQL editor and Run.

-- Singleton unlock window. One row (id = 1); unlocked while now() < unlocked_until.
create table if not exists public.admin_override (
  id             int primary key default 1 check (id = 1),
  unlocked_until timestamptz,
  opened_by      uuid references auth.users on delete set null
);
insert into public.admin_override (id) values (1) on conflict (id) do nothing;

-- Pending votes toward the next unlock. One row per admin; cleared when the
-- window opens. Votes older than 30 min are treated as stale (purged on use),
-- so the two admins have to act in the same window.
create table if not exists public.admin_override_votes (
  admin_id uuid primary key references auth.users on delete cascade,
  voted_at timestamptz not null default now()
);

-- Locked tables: only SECURITY DEFINER functions (below) and service_role touch
-- them. RLS on with no policies = no direct client reads/writes.
alter table public.admin_override enable row level security;
alter table public.admin_override_votes enable row level security;

-- Cast/refresh this admin's vote. When two distinct *current* admins have voted
-- within the window, open the 24h unlock and clear the votes. Returns the live
-- status as jsonb.
create or replace function public.request_admin_override()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_until timestamptz;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;

  delete from public.admin_override_votes where voted_at < now() - interval '30 minutes';

  insert into public.admin_override_votes (admin_id, voted_at)
  values (auth.uid(), now())
  on conflict (admin_id) do update set voted_at = now();

  select count(*) into v_count
  from public.admin_override_votes v
  join public.profiles p on p.id = v.admin_id
  where p.is_admin;

  if v_count >= 2 then
    update public.admin_override
      set unlocked_until = now() + interval '24 hours', opened_by = auth.uid()
      where id = 1
      returning unlocked_until into v_until;
    delete from public.admin_override_votes;
    return jsonb_build_object('votes', 0, 'unlocked_until', v_until);
  end if;

  return jsonb_build_object(
    'votes', v_count,
    'unlocked_until', (select unlocked_until from public.admin_override where id = 1)
  );
end;
$$;

-- Read the live status: how many admins have voted, who they are, and the
-- unlock expiry (null/past = locked). Purges stale votes so the count is honest.
create or replace function public.admin_override_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;

  delete from public.admin_override_votes where voted_at < now() - interval '30 minutes';

  select jsonb_build_object(
    'votes', coalesce(count(v.admin_id), 0),
    'voters', coalesce(array_agg(p.display_name) filter (where p.display_name is not null), '{}'),
    'unlocked_until', (select unlocked_until from public.admin_override where id = 1)
  )
  into result
  from public.admin_override_votes v
  join public.profiles p on p.id = v.admin_id
  where p.is_admin;

  return result;
end;
$$;

-- Manually re-lock (clear the window + any pending votes). Admin-only.
create or replace function public.cancel_admin_override()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  update public.admin_override set unlocked_until = null, opened_by = null where id = 1;
  delete from public.admin_override_votes;
end;
$$;

-- Boolean the Mac-mini checks (via service_role) before writing a member's
-- email. Not admin-gated — it only reports the window state — and granted only
-- to service_role, never to clients.
create or replace function public.is_override_unlocked()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce((select unlocked_until from public.admin_override where id = 1) > now(), false);
$$;

revoke all on function public.request_admin_override() from public, anon;
revoke all on function public.admin_override_status() from public, anon;
revoke all on function public.cancel_admin_override() from public, anon;
revoke all on function public.is_override_unlocked() from public, anon, authenticated;

grant execute on function public.request_admin_override() to authenticated;
grant execute on function public.admin_override_status() to authenticated;
grant execute on function public.cancel_admin_override() to authenticated;
grant execute on function public.is_override_unlocked() to service_role;
