-- 0012_committees.sql
-- Make committees REAL (they were seed-only in lib/data.ts) so each one can have
-- a private, members-only chat (0013). This adds:
--   • committees             — the groups themselves (seeded from lib/data.ts).
--   • committee_members       — who's approved in each one (the gate for chat).
--   • committee_join_requests — the request → admin-approves → added loop.
-- plus the gated RPCs that move membership (request_to_join, review_join_request,
-- set_committee_member) and the is_committee_member() helper the chat RLS leans
-- on. Apply in the Supabase SQL editor.
--
-- Security model: committee identity/rosters aren't secret (the roster page is
-- public), so committees are world-readable. Membership and join requests are
-- visible only to members of that committee + admins. Membership only ever
-- changes through the admin-gated RPCs below — there's no client write path.

-- ── Committees ───────────────────────────────────────────────────────────────
create table if not exists public.committees (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  emoji text not null default '🌲',
  description text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.committees enable row level security;

drop policy if exists "committees: public read" on public.committees;
create policy "committees: public read" on public.committees for select using (true);

drop policy if exists "committees: admin write" on public.committees;
create policy "committees: admin write" on public.committees for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Seed the three resort committees (idempotent on slug; keep in step with
-- lib/data.ts COMMITTEES). Rosters fill in via the join flow, not here.
insert into public.committees (slug, name, emoji, description, position) values
  ('resort-maintenance', 'Resort Maintenance', '🛠️', 'Cabin upkeep, docks, mowing, and getting the grounds ready each season.', 0),
  ('family-fest', 'Family Fest', '🎉', 'The big one — plans the whole week. Each person owns one or more areas (meals, events, scavenger hunt, and more).', 1),
  ('beautification', 'Beautification', '🌲', 'Planting, flower beds, trails, and keeping the resort looking its best.', 2)
on conflict (slug) do nothing;

-- ── Membership ───────────────────────────────────────────────────────────────
create table if not exists public.committee_members (
  committee_id uuid not null references public.committees (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text,                       -- e.g. 'Lead'; null = regular member
  joined_at timestamptz not null default now(),
  primary key (committee_id, user_id)
);
create index if not exists committee_members_user_idx on public.committee_members (user_id);
alter table public.committee_members enable row level security;

-- Helper: is the current user an approved member of this committee (or an admin)?
-- SECURITY DEFINER so the chat RLS policies (0013) can call it without recursing
-- through committee_members' own RLS, and admins get a blanket override (they
-- moderate every room, and it bootstraps the very first membership).
create or replace function public.is_committee_member(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.committee_members m
    where m.committee_id = cid and m.user_id = auth.uid()
  ) or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  );
$$;
revoke all on function public.is_committee_member(uuid) from public, anon;
grant execute on function public.is_committee_member(uuid) to authenticated;

-- Members (and admins) can read a committee's roster; non-members can't.
drop policy if exists "committee_members: member read" on public.committee_members;
create policy "committee_members: member read" on public.committee_members for select
  using (public.is_committee_member(committee_id));
-- No client INSERT/UPDATE/DELETE policy — membership only changes via the
-- admin-gated RPCs below.

-- ── Join requests ────────────────────────────────────────────────────────────
create table if not exists public.committee_join_requests (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  unique (committee_id, user_id)
);
create index if not exists committee_join_requests_status_idx on public.committee_join_requests (status, created_at);
alter table public.committee_join_requests enable row level security;

-- You see your own requests; admins see them all (for the approval queue).
drop policy if exists "join_requests: self or admin read" on public.committee_join_requests;
create policy "join_requests: self or admin read" on public.committee_join_requests for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
-- You can withdraw your own request; admins can clear any.
drop policy if exists "join_requests: self or admin delete" on public.committee_join_requests;
create policy "join_requests: self or admin delete" on public.committee_join_requests for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );
-- Inserts/updates go through request_to_join() / review_join_request().

-- ── RPCs that move membership ────────────────────────────────────────────────
-- Member asks to join. Idempotent: re-requesting after a rejection re-opens the
-- same row as pending. No-op if you're already a member.
create or replace function public.request_to_join(cid uuid, msg text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if exists (select 1 from public.committee_members m where m.committee_id = cid and m.user_id = auth.uid()) then
    return;
  end if;
  insert into public.committee_join_requests (committee_id, user_id, message, status)
  values (cid, auth.uid(), msg, 'pending')
  on conflict (committee_id, user_id) do update
    set status = 'pending', message = excluded.message, created_at = now(),
        reviewed_by = null, reviewed_at = null;
end;
$$;
revoke all on function public.request_to_join(uuid, text) from public, anon;
grant execute on function public.request_to_join(uuid, text) to authenticated;

-- Admin approves or rejects a request. Approving adds the member.
create or replace function public.review_join_request(req_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.committee_join_requests;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  select * into r from public.committee_join_requests where id = req_id;
  if not found then raise exception 'Request not found'; end if;
  if approve then
    insert into public.committee_members (committee_id, user_id)
    values (r.committee_id, r.user_id)
    on conflict (committee_id, user_id) do nothing;
  end if;
  update public.committee_join_requests
    set status = case when approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = req_id;
end;
$$;
revoke all on function public.review_join_request(uuid, boolean) from public, anon;
grant execute on function public.review_join_request(uuid, boolean) to authenticated;

-- Admin directly adds or removes a member (skips the request flow). Adding also
-- marks any pending request approved so the queue stays tidy.
create or replace function public.set_committee_member(cid uuid, target uuid, is_member boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if is_member then
    insert into public.committee_members (committee_id, user_id)
    values (cid, target) on conflict (committee_id, user_id) do nothing;
    update public.committee_join_requests
      set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
      where committee_id = cid and user_id = target and status = 'pending';
  else
    delete from public.committee_members where committee_id = cid and user_id = target;
  end if;
end;
$$;
revoke all on function public.set_committee_member(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_committee_member(uuid, uuid, boolean) to authenticated;
