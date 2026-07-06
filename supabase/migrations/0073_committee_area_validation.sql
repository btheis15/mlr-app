-- Committee area validation + true self-service role management.
--
-- Bug: a join request landed with area "general" even though no UI anywhere
-- offers "General" as a pickable area — the join picker, the admin roster
-- editor, and the lead's area editor all draw from the same FAMILY_FEST_AREAS
-- whitelist. Root cause: none of the RPCs that persist an area value
-- (request_to_join, review_join_request, set_committee_areas) ever validated
-- it server-side — they insert whatever text a caller passes, so a stale
-- client build, the iOS app, or a direct RPC call could write anything,
-- including the word reserved for the committee-wide default channel
-- (area IS NULL == "General", migration 0063). This closes that gap with a
-- real allow-list enforced in the database, not just the UI.
--
-- Also fixes two gaps the requester flagged:
--   1. Self-service — an existing committee member can currently only LEAVE
--      without approval (leave_committee, 0018); modifying their own areas
--      required a Lead/admin. New set_my_committee_areas() lets a member
--      manage (add/remove) their own areas with no approval needed, as long
--      as they're already a member. Only Leads/admins can promote someone to
--      "· Lead" on an area (set_committee_areas, unchanged) — self-service
--      can't self-appoint lead.
--   2. leave_committee() only ever cleared committee_members — but roster
--      membership (committee_roster.linked_user_id) has been the real access
--      gate since 0057. So leaving didn't actually revoke chat access. Now it
--      unlinks the roster slot too.

-- ── 1. Allow-list of real areas, per role-based committee ─────────────────────
create table if not exists public.committee_areas (
  committee_slug text not null,
  area           text not null,
  primary key (committee_slug, area)
);

insert into public.committee_areas (committee_slug, area) values
  ('family-fest', 'Meals'),
  ('family-fest', 'Entertainment & Games'),
  ('family-fest', 'Art & Decorating'),
  ('family-fest', 'Merchandise, Fundraising & Polling'),
  ('family-fest', 'Logistics, Scheduling & Finance')
on conflict do nothing;

-- ── 2. Validator: every element of `areas` (stripping a trailing " · Lead")
-- must be in committee_areas for that committee's slug. An empty array is
-- always fine (no area picked yet). "general"/"General" is rejected outright,
-- belt-and-suspenders, even if it were ever added to committee_areas by
-- mistake — that word is reserved for the default/General channel, never a
-- real role.
create or replace function public.valid_committee_areas(cid uuid, areas text[])
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text;
  a text;
  base text;
begin
  if areas is null or array_length(areas, 1) is null then return true; end if;

  select slug into v_slug from public.committees where id = cid;

  foreach a in array areas loop
    if a is null or lower(btrim(a)) = 'general' or btrim(a) = '' then
      return false;
    end if;
    base := case when a like '% · Lead' then left(a, length(a) - length(' · Lead')) else a end;
    if not exists (
      select 1 from public.committee_areas ca where ca.committee_slug = v_slug and ca.area = base
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.valid_committee_areas(uuid, text[]) from public, anon;
grant execute on function public.valid_committee_areas(uuid, text[]) to authenticated;

-- ── 3. request_to_join: reject an invalid area instead of silently storing it ──
create or replace function public.request_to_join(
  cid             uuid,
  msg             text    default null,
  requested_areas text[]  default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.valid_committee_areas(cid, requested_areas) then
    raise exception 'Not a valid area for this committee';
  end if;
  -- Already a member → nothing to do.
  if exists (
    select 1 from public.committee_members m
    where m.committee_id = cid and m.user_id = auth.uid()
  ) then return; end if;

  insert into public.committee_join_requests
    (committee_id, user_id, message, requested_area, requested_areas, status)
  values (
    cid, auth.uid(), msg,
    (request_to_join.requested_areas)[1],
    coalesce(request_to_join.requested_areas, '{}'),
    'pending'
  )
  on conflict (committee_id, user_id) do update
    set status          = 'pending',
        message         = excluded.message,
        requested_area  = excluded.requested_area,
        requested_areas = excluded.requested_areas,
        created_at      = now(),
        reviewed_by     = null,
        reviewed_at     = null;
end;
$$;
revoke all on function public.request_to_join(uuid, text, text[]) from public, anon;
grant execute on function public.request_to_join(uuid, text, text[]) to authenticated;

-- ── 4. review_join_request: re-validate on approve (defense in depth) ─────────
-- Drops any invalid area rather than blocking the approval outright — by the
-- time an admin is reviewing, the request already exists; approving the
-- person while stripping the bad value is friendlier than a hard failure.
create or replace function public.review_join_request(req_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       public.committee_join_requests;
  v_areas text[];
  v_slug  text;
  v_name  text;
  v_email text;
begin
  select * into r from public.committee_join_requests where id = req_id;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_committee_lead(r.committee_id) then
    raise exception 'Not authorized';
  end if;

  if approve then
    v_areas := case
      when coalesce(array_length(r.requested_areas, 1), 0) > 0 then r.requested_areas
      when r.requested_area is not null then array[r.requested_area]
      else '{}'::text[]
    end;
    -- Strip anything that isn't a real area for this committee (e.g. "general").
    if v_areas is not null and array_length(v_areas, 1) is not null then
      select coalesce(array_agg(a), '{}') into v_areas
      from unnest(v_areas) a
      where lower(btrim(a)) <> 'general' and btrim(a) <> ''
        and public.valid_committee_areas(r.committee_id, array[a]);
    end if;

    insert into public.committee_members (committee_id, user_id, areas)
    values (r.committee_id, r.user_id, v_areas)
    on conflict (committee_id, user_id) do update set areas = excluded.areas;

    select slug into v_slug from public.committees where id = r.committee_id;
    select coalesce(nullif(btrim(display_name), ''), 'Member'),
           nullif(btrim(contact_email), '')
      into v_name, v_email
      from public.profiles where id = r.user_id;

    insert into public.committee_roster
      (committee_slug, name, email, roles, linked_user_id, updated_at, updated_by)
    values (v_slug, v_name, v_email, v_areas, r.user_id, now(), auth.uid())
    on conflict (committee_slug, name) do update
      set roles          = excluded.roles,
          email          = coalesce(public.committee_roster.email, excluded.email),
          linked_user_id = r.user_id,
          updated_at     = now(),
          updated_by     = auth.uid();
  end if;

  update public.committee_join_requests
    set status      = case when approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = req_id;
end;
$$;
revoke all on function public.review_join_request(uuid, boolean) from public, anon;
grant execute on function public.review_join_request(uuid, boolean) to authenticated;

-- ── 5. set_committee_areas (Lead/admin editing someone else): validate too ────
create or replace function public.set_committee_areas(cid uuid, target uuid, areas text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_committee_lead(cid) then
    raise exception 'Only a committee lead or app admin can set member areas';
  end if;
  if not public.valid_committee_areas(cid, areas) then
    raise exception 'Not a valid area for this committee';
  end if;
  update public.committee_members
    set areas = set_committee_areas.areas
    where committee_id = cid and target = user_id;

  -- Keep the roster mirror in sync so chat-area access matches immediately.
  update public.committee_roster r
     set roles = set_committee_areas.areas, updated_at = now()
    from public.committees c
   where c.id = cid and c.slug = r.committee_slug and r.linked_user_id = target;
end;
$$;
revoke all on function public.set_committee_areas(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_committee_areas(uuid, uuid, text[]) to authenticated;

-- ── 6. NEW: set_my_committee_areas — self-service, no approval needed ─────────
-- Any existing member can add/remove their OWN areas. Can't be used to
-- self-appoint "· Lead" (any Lead suffix in the input is stripped) or to
-- affect anyone else. Not a member yet? Nothing to self-manage — use
-- request_to_join instead (which does need admin approval).
create or replace function public.set_my_committee_areas(cid uuid, areas text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_areas text[];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not public.is_committee_member(cid) then
    raise exception 'Join the committee first — ask an admin to approve your request';
  end if;

  -- Strip any "· Lead" a caller might pass; self-service never grants lead.
  select coalesce(array_agg(distinct trim(a)), '{}')
    into v_areas
    from unnest(coalesce(areas, '{}')) a
   where trim(a) <> ''
     and lower(trim(a)) <> 'general'
     and a not like '% · Lead';

  if not public.valid_committee_areas(cid, v_areas) then
    raise exception 'Not a valid area for this committee';
  end if;

  update public.committee_members
     set areas = v_areas
   where committee_id = cid and user_id = auth.uid();

  update public.committee_roster r
     set roles = v_areas, updated_at = now()
    from public.committees c
   where c.id = cid and c.slug = r.committee_slug and r.linked_user_id = auth.uid();
end;
$$;
revoke all on function public.set_my_committee_areas(uuid, text[]) from public, anon;
grant execute on function public.set_my_committee_areas(uuid, text[]) to authenticated;

-- ── 7. leave_committee: actually revoke roster-based access too ───────────────
-- Roster membership has been the real gate since 0057; this table-only delete
-- left a linked roster slot (and its access) fully intact.
create or replace function public.leave_committee(cid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  delete from public.committee_members where committee_id = cid and user_id = auth.uid();
  delete from public.committee_join_requests where committee_id = cid and user_id = auth.uid();
  update public.committee_roster r
     set linked_user_id = null, roles = '{}', updated_at = now()
    from public.committees c
   where c.id = cid and c.slug = r.committee_slug and r.linked_user_id = auth.uid();
end;
$$;
revoke all on function public.leave_committee(uuid) from public, anon;
grant execute on function public.leave_committee(uuid) to authenticated;

-- ── 8. Data cleanup: strip the bad "general" value wherever it landed ─────────
update public.committee_members
   set areas = array_remove(array_remove(areas, 'general'), 'General')
 where 'general' = any(areas) or 'General' = any(areas);

update public.committee_roster
   set roles = array_remove(array_remove(roles, 'general'), 'General'),
       updated_at = now()
 where 'general' = any(roles) or 'General' = any(roles);

update public.committee_join_requests
   set requested_area = null
 where lower(btrim(requested_area)) = 'general';

update public.committee_join_requests
   set requested_areas = array_remove(array_remove(requested_areas, 'general'), 'General')
 where 'general' = any(requested_areas) or 'General' = any(requested_areas);
