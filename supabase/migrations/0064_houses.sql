-- 0064_houses.sql
-- "Houses": a way to designate members into a group (e.g. "MJT House") that gets
-- its own private chat (0065) and its own scoped work items (0066). A member
-- belongs to at most ONE house, so membership is a single FK column on profiles
-- rather than a roster/membership table (much simpler than committees). Everyone
-- is always "MLR" by default — a house is an ADDITIONAL, narrower group layered on
-- top; it never replaces the resort-wide surfaces.
--
-- What this adds:
--   • houses                 — the groups themselves (seeded with MJT House).
--   • profiles.house_id       — the member's single house (admin-assigned only).
--   • is_house_member(hid)    — the gate every house RLS policy leans on (0065/0066).
--   • set_member_house(...)   — admin-only assignment RPC (clone of set_admin, 0008).
--   • admin_members() widened — so the admin directory shows each member's house.
--
-- Security model: house identity isn't secret (a house name/emoji), so houses are
-- world-readable like committees (0012). Assignment (profiles.house_id) is admin-
-- only: house_id is deliberately NOT in any `grant update(...) to authenticated`
-- list, so a client can never self-assign — same guardrail as is_admin /
-- beta_tester. Apply in the Supabase SQL editor after 0063.

-- ── Houses ───────────────────────────────────────────────────────────────────
create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  emoji text not null default '🏠',
  description text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.houses enable row level security;

drop policy if exists "houses: public read" on public.houses;
create policy "houses: public read" on public.houses for select using (true);

drop policy if exists "houses: admin write" on public.houses;
create policy "houses: admin write" on public.houses for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Seed the first house. Rosters fill in via admin assignment, not here.
insert into public.houses (slug, name, emoji, description, position) values
  ('mjt-house', 'MJT House', '🏠', 'The MJT House crew — chat and work items just for this house.', 0)
on conflict (slug) do nothing;

-- ── Membership: one house per member ─────────────────────────────────────────
-- on delete set null so removing a house just un-assigns its members (their MLR
-- access is unaffected). NOT added to the client update allowlist → admin-only.
alter table public.profiles
  add column if not exists house_id uuid references public.houses (id) on delete set null;

create index if not exists profiles_house_idx on public.profiles (house_id);

-- Helper: is the current user a member of this house (or an admin)? SECURITY
-- DEFINER so chat/work RLS can call it without recursing through profiles' own
-- policies; admins get a blanket override (they moderate every room). Direct
-- mirror of is_committee_member (0057) but simpler — a house is a single room.
create or replace function public.is_house_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.house_id = hid
  ) or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  );
$$;
revoke all on function public.is_house_member(uuid) from public, anon;
grant execute on function public.is_house_member(uuid) to authenticated;

-- ── Admin assignment ─────────────────────────────────────────────────────────
-- Assign a member to a house (or clear it with hid = null). Admins only — clone
-- of set_admin (0008) / set_beta_tester (0029). This is the only write path for
-- profiles.house_id, so overriding/seeding existing accounts goes through here.
create or replace function public.set_member_house(target uuid, hid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if hid is not null and not exists (select 1 from public.houses h where h.id = hid) then
    raise exception 'House not found';
  end if;
  update public.profiles set house_id = hid where id = target;
end;
$$;
revoke all on function public.set_member_house(uuid, uuid) from public, anon;
grant execute on function public.set_member_house(uuid, uuid) to authenticated;

-- ── admin_members(): add house to the directory ──────────────────────────────
-- Return-type change, so drop + recreate (create-or-replace can't widen the TABLE
-- signature — same as 0029). Same body as 0029, plus the member's house.
drop function if exists public.admin_members();
create function public.admin_members()
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  household text,
  email text,
  is_admin boolean,
  beta_tester boolean,
  house_id uuid,
  house_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  return query
    select p.id, p.display_name, p.avatar_url, p.household,
           u.email::text, p.is_admin, p.beta_tester, p.house_id, h.name, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.houses h on h.id = p.house_id
    order by p.is_admin desc, lower(coalesce(p.display_name, u.email::text));
end;
$$;

revoke all on function public.admin_members() from public, anon;
grant execute on function public.admin_members() to authenticated;
