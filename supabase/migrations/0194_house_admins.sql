-- 0194_house_admins.sql
--
-- HOUSE ADMINS — a leadership tier for houses.
--
-- Houses (0064) are deliberately flat: a member belongs to at most ONE house
-- (profiles.house_id), assignment is admin-only, and there is no lead/organizer
-- concept anywhere (can_organize_meeting, 0116, even says "Houses are
-- admin-only"). Committees got theirs in 0177 via a single additive boolean +
-- one inlined predicate; this is the same move for houses, and it exists so a
-- house can run its OWN money decisions (see 0195_house_requests.sql) without
-- everything funnelling through an app admin.
--
-- WHO CAN APPOINT ONE (the rule Brian specified): an App Admin who is THEMSELVES
-- in that house. Not any app admin, not a house admin promoting peers — you must
-- hold both `is_admin` and `house_id = <that house>`. So nobody administers a
-- house they aren't part of, and the power to grant it never leaks below app
-- admin. There is intentionally no in-app bootstrap escape hatch: if no app
-- admin is assigned to a house, the first House Admin there is set by hand in
-- the SQL editor, exactly how the first app admin was bootstrapped (0008).
--
-- WHY A BOOLEAN, NOT A JOIN TABLE: one house per member means "House Admin"
-- can only ever mean "admin of MY house", so the flag needs no house_id of its
-- own — a direct mirror of profiles.is_admin. The trade-off is that a House
-- Admin cannot administer a house they don't belong to, which is exactly the
-- rule above rather than a limitation.
--
-- LOOKING AHEAD (not built here): "Resort Admins" — the LEDO Trust — will be the
-- same shape for resort-wide (house_id is null) requests. can_review_house_request
-- below is the ONE function that has to change for that: add an
-- `or public.is_ledo_trustee()` branch to its null-scope arm and every RPC,
-- policy and screen in 0195 picks it up untouched.
--
-- Apply in the Supabase SQL editor after 0193.

-- ── 1. The marker ────────────────────────────────────────────────────────────
-- Additive, defaults false, so every existing member is unaffected and each
-- house starts with zero House Admins until one is named.
--
-- Deliberately NOT added to any `grant update(...) on public.profiles to
-- authenticated` list. profiles' blanket revoke (0001) covers new columns by
-- default, so set_house_admin() below is the ONLY write path — the same
-- escalation guard as is_admin (0001), house_id (0064) and
-- notifications_confirmed (0157). A client cannot self-promote.
alter table public.profiles
  add column if not exists house_admin boolean not null default false;

create index if not exists profiles_house_admin_idx
  on public.profiles (house_id) where house_admin;

comment on column public.profiles.house_admin is
  'House Admin of the member''s OWN house (profiles.house_id) — reviews that house''s requests (0195). Set only via set_house_admin(); cleared automatically when the member changes houses.';

-- ── 2. "Is the caller a House Admin of this house?" ──────────────────────────
-- Strict: DELIBERATELY no app-admin override, mirroring is_committee_lead
-- (0177). This answers "who actually holds this role" — it drives the
-- notification fan-out and the "ask one of these people" list on the House Hub,
-- and neither should silently include every app admin. Use
-- can_review_house_request() below for permission checks, not this.
--
-- SECURITY DEFINER so RLS on other tables can call it without recursing through
-- profiles' own policies (same reason as is_house_member, 0064).
create or replace function public.is_house_admin(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select hid is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.house_admin
      and p.house_id = hid
  );
$$;
revoke all on function public.is_house_admin(uuid) from public, anon;
grant execute on function public.is_house_admin(uuid) to authenticated;

-- ── 3. The review gate ───────────────────────────────────────────────────────
-- App admin (they moderate every surface) OR a House Admin of that house.
--
-- `hid is null` means RESORT-WIDE (the work_items convention from 0066), which
-- today only app admins can review. ⚠️ THIS IS THE SEAM FOR THE LEDO TRUST —
-- widen the null branch here and nothing else in the feature needs touching.
create or replace function public.can_review_house_request(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
    or public.is_house_admin(hid);
$$;
revoke all on function public.can_review_house_request(uuid) from public, anon;
grant execute on function public.can_review_house_request(uuid) to authenticated;

-- ── 4. Assignment ────────────────────────────────────────────────────────────
-- Clone of set_admin (0008) / set_member_house (0064) with the narrower caller
-- test described in the header. Every failure raises a distinct message so the
-- admin UI can explain WHY rather than showing a generic "Not authorized".
create or replace function public.set_house_admin(target uuid, value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_house  uuid;
  v_is_admin  boolean;
  v_their_house uuid;
begin
  select p.is_admin, p.house_id into v_is_admin, v_my_house
    from public.profiles p where p.id = auth.uid();

  if not coalesce(v_is_admin, false) then
    raise exception 'Only app admins can set House Admins';
  end if;
  if v_my_house is null then
    raise exception 'You have to be in a house yourself to set its House Admins';
  end if;

  select p.house_id into v_their_house from public.profiles p where p.id = target;
  if not found then
    raise exception 'Member not found';
  end if;
  if v_their_house is null then
    raise exception 'Assign them to a house first';
  end if;
  if v_their_house is distinct from v_my_house then
    raise exception 'You can only set House Admins for your own house';
  end if;

  update public.profiles set house_admin = coalesce(value, false) where id = target;
end;
$$;
revoke all on function public.set_house_admin(uuid, boolean) from public, anon;
grant execute on function public.set_house_admin(uuid, boolean) to authenticated;

-- ── 5. Moving houses drops the role ──────────────────────────────────────────
-- Without this, someone reassigned from House A to House B keeps house_admin =
-- true and silently becomes an approver of House B (is_house_admin keys on the
-- CURRENT house_id) — a real privilege escalation via an unrelated admin action.
-- Clearing it on any change is the safe direction: worst case a House Admin who
-- was moved has to be re-named.
--
-- ⚠️ Recreated from set_member_house's CURRENT production definition — the
-- 0160/0187 rule. Verified: 0064 is the ONLY migration that defines this
-- function (0072/0123/0181 merely mention it in comments), so 0064's body IS
-- production. The only change below is the `house_admin = false` in the UPDATE.
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
  update public.profiles
     set house_id = hid,
         -- Leaving/changing a house gives up the House Admin role with it.
         house_admin = case when house_id is distinct from hid then false else house_admin end
   where id = target;
end;
$$;
revoke all on function public.set_member_house(uuid, uuid) from public, anon;
grant execute on function public.set_member_house(uuid, uuid) to authenticated;

-- ── 6. Sanity check ──────────────────────────────────────────────────────────
-- Nobody is a House Admin yet (expected: 0). The admin UI (Admin → Houses) is
-- how the first one gets named — by an app admin who is in that house.
select count(*) as house_admins, count(*) filter (where house_id is null) as orphaned
  from public.profiles where house_admin;
