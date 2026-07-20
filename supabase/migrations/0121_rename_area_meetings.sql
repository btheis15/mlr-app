-- 0121_rename_area_meetings.sql
-- Keep meeting scheduling working when an admin RENAMES a committee role/area.
-- rename_committee_area (migration 0112) cascades a role's new name through all
-- the places it's denormalized (allow-list, roster roles[], committee_members
-- areas[], committee_messages.area, committee_area_reads.area, join requests) —
-- but it predates the meetings feature (0116), so a meeting scoped to that role
-- (meetings.area, which stores the base name like committee_messages.area) would
-- be left pointing at the OLD name and become invisible/inaccessible after a
-- rename (can_access_committee_area matches the roster's NEW name).
--
-- This redefines rename_committee_area to add one more cascade step: meetings.
-- (Newly created committees and committee *renames* already work — a create is a
-- real DB row, and update_committee never changes the slug/id meetings key off.)
--
-- Apply in the Supabase SQL editor after 0120.

create or replace function public.rename_committee_area(cid uuid, p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_old  text := btrim(p_old);
  v_new  text := btrim(p_new);
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Not authorized';
  end if;
  if v_new = '' or lower(v_new) = 'general' or v_new like '% · Lead' then
    raise exception 'Invalid role name';
  end if;
  select slug into v_slug from public.committees where id = cid;
  if v_slug is null then raise exception 'Committee not found'; end if;
  if v_old = v_new then return; end if;
  if exists (select 1 from public.committee_areas where committee_slug = v_slug and area = v_new) then
    raise exception 'A role named "%" already exists here', v_new;
  end if;

  -- 1. allow-list
  update public.committee_areas
    set area = v_new
    where committee_slug = v_slug and area = v_old;

  -- 2. roster roles[]  (preserve a trailing " · Lead")
  update public.committee_roster
    set roles = (
          select array_agg(
            case
              when r = v_old              then v_new
              when r = v_old || ' · Lead' then v_new || ' · Lead'
              else r
            end)
          from unnest(roles) r),
        updated_at = now()
    where committee_slug = v_slug
      and (v_old = any(roles) or (v_old || ' · Lead') = any(roles));

  -- 3. committee_members.areas[]
  update public.committee_members
    set areas = (
          select array_agg(
            case
              when a = v_old              then v_new
              when a = v_old || ' · Lead' then v_new || ' · Lead'
              else a
            end)
          from unnest(areas) a)
    where committee_id = cid
      and (v_old = any(areas) or (v_old || ' · Lead') = any(areas));

  -- 4. chat history (area stores the base name, no Lead suffix — migration 0063)
  update public.committee_messages
    set area = v_new
    where committee_id = cid and area = v_old;

  -- 5. per-channel read state (guard against a pre-existing v_new row)
  delete from public.committee_area_reads r
    where r.committee_id = cid and r.area = v_old
      and exists (
        select 1 from public.committee_area_reads r2
        where r2.committee_id = cid and r2.user_id = r.user_id and r2.area = v_new);
  update public.committee_area_reads
    set area = v_new
    where committee_id = cid and area = v_old;

  -- 6. join requests
  update public.committee_join_requests
    set requested_areas = (select array_agg(case when a = v_old then v_new else a end) from unnest(requested_areas) a)
    where committee_id = cid and v_old = any(requested_areas);
  update public.committee_join_requests
    set requested_area = v_new
    where committee_id = cid and requested_area = v_old;

  -- 7. meetings (migration 0121) — a role-scoped meeting follows the rename too,
  --    same as chat history (meetings.area stores the base name).
  update public.meetings
    set area = v_new
    where committee_id = cid and area = v_old;
end;
$$;
revoke all on function public.rename_committee_area(uuid, text, text) from public, anon;
grant execute on function public.rename_committee_area(uuid, text, text) to authenticated;
