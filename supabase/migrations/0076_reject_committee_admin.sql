-- 0076_reject_committee_admin.sql
-- "Committee Admin" is no longer a thing: within a committee there are only role
-- Leads + regular members; the only admins are overall APP admins (profiles.is_admin).
-- Migration 0073 already rejects any area that isn't a real committee area (so an
-- old client asking for "Admin" fails), but with a generic "Not a valid area"
-- message. Old app builds still out there may present an "Admin" option — this
-- gives those requests a clear, friendly error telling the person to update,
-- enforced in the database so it works no matter how stale the client is (they
-- don't even need to reopen the app — the server rejects the RPC either way).
--
-- Belt-and-suspenders: also guards the Lead/admin area-assignment paths and
-- backfills away any stray "admin" value already stored.

-- Detects a request/assignment referencing the removed Committee Admin role
-- (case-insensitive; ignores a trailing " · Lead").
create or replace function public.mentions_removed_admin_role(areas text[])
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from unnest(coalesce(areas, '{}')) a
    where lower(btrim(replace(a, ' · Lead', ''))) in ('admin', 'admins', 'committee admin', 'committee admins')
  );
$$;

comment on function public.mentions_removed_admin_role(text[]) is
  'True if any area names the removed per-committee "Admin" role.';

-- The shared friendly error, raised from every write path below.
-- (Inlined per function since a plpgsql RAISE can''t be shared as an expression.)

-- ── request_to_join: friendly "update your app" for Admin requests ────────────
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
  if public.mentions_removed_admin_role(requested_areas) then
    raise exception 'Committee Admin is no longer a role — please update to the latest version of the app, then pick a role to join.';
  end if;
  if not public.valid_committee_areas(cid, requested_areas) then
    raise exception 'Not a valid area for this committee';
  end if;
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

-- ── set_committee_areas (Lead/admin editing someone else) ─────────────────────
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
  if public.mentions_removed_admin_role(areas) then
    raise exception 'Committee Admin is no longer a role — please update to the latest version of the app.';
  end if;
  if not public.valid_committee_areas(cid, areas) then
    raise exception 'Not a valid area for this committee';
  end if;
  update public.committee_members
    set areas = set_committee_areas.areas
    where committee_id = cid and target = user_id;

  update public.committee_roster r
     set roles = set_committee_areas.areas, updated_at = now()
    from public.committees c
   where c.id = cid and c.slug = r.committee_slug and r.linked_user_id = target;
end;
$$;
revoke all on function public.set_committee_areas(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_committee_areas(uuid, uuid, text[]) to authenticated;

-- ── set_my_committee_areas (self-service) ─────────────────────────────────────
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
  if public.mentions_removed_admin_role(areas) then
    raise exception 'Committee Admin is no longer a role — please update to the latest version of the app.';
  end if;
  if not public.is_committee_member(cid) then
    raise exception 'Join the committee first — ask an admin to approve your request';
  end if;

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

-- ── Data cleanup: strip any stored "admin" role/area left over ────────────────
update public.committee_members
   set areas = array_remove(array_remove(areas, 'admin'), 'Admin')
 where 'admin' = any(areas) or 'Admin' = any(areas);

update public.committee_roster
   set roles = array_remove(array_remove(roles, 'admin'), 'Admin'),
       updated_at = now()
 where 'admin' = any(roles) or 'Admin' = any(roles);

update public.committee_join_requests
   set requested_area = null
 where lower(btrim(coalesce(requested_area, ''))) in ('admin', 'committee admin');

update public.committee_join_requests
   set requested_areas = array_remove(array_remove(requested_areas, 'admin'), 'Admin')
 where 'admin' = any(requested_areas) or 'Admin' = any(requested_areas);
